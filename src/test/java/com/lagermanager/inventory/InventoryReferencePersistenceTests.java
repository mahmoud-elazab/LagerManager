package com.lagermanager.inventory;

import com.lagermanager.LagermanagerApplication;
import com.lagermanager.product.Product;
import com.lagermanager.product.ProductRepository;
import com.lagermanager.product.ProductService;
import com.lagermanager.warehouse.Warehouse;
import com.lagermanager.warehouse.WarehouseRepository;
import com.lagermanager.warehouse.WarehouseService;
import com.lagermanager.security.JwtService;
import com.lagermanager.support.DisposableMySql;
import com.lagermanager.user.Role;
import com.lagermanager.user.User;
import com.lagermanager.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.json.JsonMapper;

import javax.sql.DataSource;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Base64;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.doAnswer;

@SpringBootTest(classes = LagermanagerApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@org.springframework.test.context.ActiveProfiles("test")
@EnabledIf("com.lagermanager.support.DisposableMySql#isAvailable")
class InventoryReferencePersistenceTests {
    @DynamicPropertySource
    static void isolatedProperties(DynamicPropertyRegistry registry) {
        DisposableMySql.configure(registry, "lagermanager_reference_test");
        String secret = Base64.getEncoder().encodeToString(io.jsonwebtoken.Jwts.SIG.HS256.key().build().getEncoded());
        registry.add("LAGERMANAGER_JWT_SECRET", () -> secret);
    }

    @Autowired ProductRepository products;
    @Autowired WarehouseRepository warehouses;
    @MockitoSpyBean InventoryRepository inventories;
    @Autowired ProductService productService;
    @Autowired WarehouseService warehouseService;
    @Autowired UserRepository users;
    @Autowired JwtService jwt;
    @Autowired DataSource dataSource;
    @Autowired EntityManager entityManager;
    @LocalServerPort int port;
    private Product product;
    private Warehouse warehouse;
    private User admin;

    @BeforeEach
    void fixtures() {
        inventories.deleteAllInBatch();
        products.deleteAllInBatch();
        warehouses.deleteAllInBatch();
        users.deleteAllInBatch();
        product = products.saveAndFlush(new Product(null, "Fictional product", "TEST", null, 0, BigDecimal.ONE, null));
        warehouse = warehouses.saveAndFlush(new Warehouse(null, "Fictional warehouse", "Test location", 10));
        admin = users.saveAndFlush(new User(null, "fictional@example.com", "unused-test-value", Role.ADMIN, true));
    }

    @ParameterizedTest
    @ValueSource(strings = {"product", "warehouse"})
    void linkedDeletionReturnsExactSafeConflictAndDoesNotCascade(String resource) throws Exception {
        inventories.saveAndFlush(new Inventory(null, product, warehouse, 1));
        HttpResponse<String> response = delete(resource, admin);
        assertEquals(409, response.statusCode());
        var body = JsonMapper.builder().build().readTree(response.body());
        assertEquals(2, body.size());
        assertEquals("INVENTORY_REFERENCE_CONFLICT", body.get("code").asString());
        assertEquals("This " + resource + " is used by inventory and cannot be deleted.", body.get("message").asString());
        assertFalse(response.body().contains("SQLException"));
        assertTrue(products.existsById(product.getId()));
        assertTrue(warehouses.existsById(warehouse.getId()));
        assertEquals(1, inventories.count());
    }

    @ParameterizedTest
    @ValueSource(strings = {"product", "warehouse"})
    void unlinkedDeletionAndMissingIdRemainSuccessful(String resource) throws Exception {
        assertEquals(200, delete(resource, admin).statusCode());
        assertFalse(exists(resource));
        // Existing deleteById semantics: an absent record still succeeds without a new 404 policy.
        assertEquals(200, delete(resource, admin).statusCode());
    }

    @ParameterizedTest
    @ValueSource(strings = {"product", "warehouse"})
    void managerAndEmployeeCannotDelete(String resource) throws Exception {
        for (Role role : new Role[] { Role.MANAGER, Role.EMPLOYEE }) {
            admin.setRole(role);
            users.saveAndFlush(admin);
            assertEquals(403, delete(resource, admin).statusCode());
            assertTrue(exists(resource));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"product", "warehouse"})
    void actualForeignKeysRejectDirectParentDeletionWithoutCascade(String resource) throws Exception {
        inventories.saveAndFlush(new Inventory(null, product, warehouse, 1));
        try (Connection metadata = dataSource.getConnection(); var statement = metadata.createStatement()) {
            try (var tables = statement.executeQuery("SELECT ENGINE FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('product', 'warehouse', 'inventory')")) {
                int count = 0;
                while (tables.next()) { assertEquals("InnoDB", tables.getString(1)); count++; }
                assertEquals(3, count);
            }
            try (var constraints = statement.executeQuery("SELECT DELETE_RULE FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name = 'inventory'")) {
                int count = 0;
                while (constraints.next()) {
                    assertTrue(java.util.Set.of("RESTRICT", "NO ACTION").contains(constraints.getString(1)));
                    count++;
                }
                assertEquals(2, count);
            }
        }
        try (Connection connection = dataSource.getConnection(); var sql = connection.prepareStatement(
                "DELETE FROM " + resource + " WHERE id = ?")) {
            sql.setLong(1, id(resource));
            SQLException failure = assertThrows(SQLException.class, sql::executeUpdate);
            assertEquals("23000", failure.getSQLState());
            assertEquals(1451, failure.getErrorCode());
        }
        assertTrue(exists(resource));
        assertEquals(1, inventories.count());
    }

    @ParameterizedTest
    @ValueSource(strings = {"product", "warehouse"})
    void writerCommittedBeforeParentLockIsSeenByTheConflictCheck(String resource) throws Exception {
        try (Connection writer = dataSource.getConnection(); var pool = Executors.newFixedThreadPool(1)) {
            writer.setAutoCommit(false);
            insertInventory(writer);
            CountDownLatch started = new CountDownLatch(1);
            var deletion = pool.submit(() -> { started.countDown(); remove(resource); });
            try {
                assertTrue(started.await(2, TimeUnit.SECONDS));
                assertThrows(TimeoutException.class, () -> deletion.get(200, TimeUnit.MILLISECONDS));
            } finally { writer.commit(); }
            ExecutionException failure = assertThrows(ExecutionException.class, () -> deletion.get(5, TimeUnit.SECONDS));
            assertInstanceOf(InventoryReferenceConflictException.class, failure.getCause());
        }
        assertTrue(exists(resource));
        assertEquals(1, inventories.count());
    }

    @ParameterizedTest
    @ValueSource(strings = {"product", "warehouse"})
    void writerAfterReferenceCheckCannotSlipBetweenCheckAndDelete(String resource) throws Exception {
        CountDownLatch checked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        var barrier = (org.mockito.stubbing.Answer<Boolean>) invocation -> {
            // The spy supplies only a scheduling barrier; query the real transaction-bound MySQL session.
            boolean result = entityManager.createQuery("select count(i) from Inventory i where i." + resource + ".id = :id", Long.class)
                    .setParameter("id", id(resource)).getSingleResult() > 0;
            assertFalse(result);
            checked.countDown();
            assertTrue(release.await(5, TimeUnit.SECONDS));
            return result;
        };
        if (resource.equals("product")) doAnswer(barrier).when(inventories).existsByProduct_Id(product.getId());
        else doAnswer(barrier).when(inventories).existsByWarehouse_Id(warehouse.getId());
        try (var pool = Executors.newFixedThreadPool(2)) {
            var deletion = pool.submit(() -> remove(resource));
            assertTrue(checked.await(5, TimeUnit.SECONDS));
            CountDownLatch writerStarted = new CountDownLatch(1);
            var insertion = pool.submit(() -> {
                try (Connection writer = dataSource.getConnection()) {
                    writerStarted.countDown();
                    insertInventory(writer);
                }
                return null;
            });
            try {
                assertTrue(writerStarted.await(2, TimeUnit.SECONDS));
                assertThrows(TimeoutException.class, () -> insertion.get(200, TimeUnit.MILLISECONDS));
            } finally { release.countDown(); }
            deletion.get(5, TimeUnit.SECONDS);
            ExecutionException failure = assertThrows(ExecutionException.class, () -> insertion.get(5, TimeUnit.SECONDS));
            SQLException sql = assertInstanceOf(SQLException.class, failure.getCause());
            assertEquals("23000", sql.getSQLState());
            assertEquals(1452, sql.getErrorCode());
        } finally { release.countDown(); }
        assertFalse(exists(resource));
        assertEquals(0, inventories.count());
    }

    @Test
    void unrelatedIntegrityFailureRemains500AndRollsBack() throws Exception {
        try (Connection connection = dataSource.getConnection(); var sql = connection.createStatement()) {
            sql.execute("CREATE TABLE other_product_reference (id INT PRIMARY KEY, product_id BIGINT, FOREIGN KEY (product_id) REFERENCES product(id)) ENGINE=InnoDB");
            try {
                sql.execute("INSERT INTO other_product_reference VALUES (1, " + product.getId() + ")");
                HttpResponse<String> response = delete("product", admin);
                assertEquals(500, response.statusCode());
                assertFalse(response.body().contains("INVENTORY_REFERENCE_CONFLICT"));
                assertFalse(response.body().contains("other_product_reference"));
                assertTrue(products.existsById(product.getId()));
            } finally { sql.execute("DROP TABLE other_product_reference"); }
        }
    }

    private long id(String resource) { return resource.equals("product") ? product.getId() : warehouse.getId(); }
    private boolean exists(String resource) { return resource.equals("product") ? products.existsById(product.getId()) : warehouses.existsById(warehouse.getId()); }
    private void remove(String resource) {
        if (resource.equals("product")) productService.deleteProduct(product.getId());
        else warehouseService.deleteWarehouse(warehouse.getId());
    }
    private void insertInventory(Connection connection) throws SQLException {
        try (var sql = connection.prepareStatement("INSERT INTO inventory (product_id, warehouse_id, quantity) VALUES (?, ?, 1)")) {
            sql.setLong(1, product.getId()); sql.setLong(2, warehouse.getId()); sql.executeUpdate();
        }
    }
    private HttpResponse<String> delete(String resource, User user) throws Exception {
        String path = resource.equals("product") ? "products" : "warehouses";
        try (HttpClient client = HttpClient.newHttpClient()) {
            return client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/" + path + "/" + id(resource)))
                    .header("Authorization", "Bearer " + jwt.generateToken(user)).header("Accept", "application/json")
                    .DELETE().build(), HttpResponse.BodyHandlers.ofString());
        }
    }
}
