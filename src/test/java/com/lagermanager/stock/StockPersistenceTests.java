package com.lagermanager.stock;

import com.lagermanager.LagermanagerApplication;
import com.lagermanager.support.DisposableMySql;
import com.lagermanager.inventory.*;
import com.lagermanager.product.*;
import com.lagermanager.warehouse.*;
import com.lagermanager.user.*;
import com.lagermanager.demo.*;
import com.lagermanager.security.JwtService;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIf;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import javax.sql.DataSource;
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.*;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(classes = LagermanagerApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@org.springframework.test.context.ActiveProfiles("test")
@EnabledIf("com.lagermanager.support.DisposableMySql#isAvailable")
class StockPersistenceTests {
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        DisposableMySql.configure(registry, "lagermanager_demo_test");
        String testSecret = Base64.getEncoder().encodeToString(io.jsonwebtoken.Jwts.SIG.HS256.key().build().getEncoded());
        registry.add("LAGERMANAGER_JWT_SECRET", () -> testSecret);
    }
    @Autowired ProductRepository products;
    @Autowired WarehouseRepository warehouses;
    @Autowired InventoryRepository inventories;
    @Autowired InventoryService inventoryService;
    @Autowired StockService stock;
    @Autowired StockMovementRepository movements;
    @Autowired UserRepository users;
    @Autowired DemoSeedStateRepository states;
    @Autowired DemoSeedRecordRepository seedRecords;
    @Autowired DemoSeeder seeder;
    @Autowired PasswordEncoder encoder;
    @Autowired JwtService jwt;
    @Autowired DataSource dataSource;
    @LocalServerPort int port;
    Product product;
    Warehouse warehouse;

    @BeforeEach void clean() {
        seedRecords.deleteAllInBatch();
        movements.deleteAllInBatch(); inventories.deleteAllInBatch(); products.deleteAllInBatch();
        warehouses.deleteAllInBatch(); users.deleteAllInBatch(); states.deleteAllInBatch();
        authenticate("stock.counter@example.test");
    }
    @AfterEach void clear() { SecurityContextHolder.clearContext(); }
    private void authenticate(String actor) {
        SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(actor, null, List.of()));
    }
    private Inventory fixture(int quantity) {
        product = products.saveAndFlush(new Product(null, "Fictional bolts", "TEST-BOLT", "Keep description", 777, new BigDecimal("12.50"), null));
        warehouse = warehouses.saveAndFlush(new Warehouse(null, "Fictional depot", "Test location", 100));
        return inventoryService.createInventory(new InventoryRequest(product.getId(), warehouse.getId(), quantity));
    }
    @Test void arithmeticAndActorAreRecordedAndNoOpDoesNotInventMovement() {
        Inventory inventory = fixture(10);
        stock.move(inventory.getId(), MovementType.RECEIVE, 5, "Delivery");
        stock.move(inventory.getId(), MovementType.ISSUE, 3, "Dispatch");
        stock.move(inventory.getId(), MovementType.ADJUST, 4, "Cycle count");
        stock.move(inventory.getId(), MovementType.ADJUST, 4, "Count unchanged");
        var history = stock.history(inventory.getId());
        assertEquals(4, history.size());
        assertEquals(List.of(-8L, -3L, 5L, 10L), history.stream().map(StockMovement::getQuantityChange).toList());
        assertEquals(4, inventories.findById(inventory.getId()).orElseThrow().getQuantity());
        for (StockMovement movement : history) {
            assertEquals("stock.counter@example.test", movement.getActor());
            assertNotNull(movement.getTimestamp());
            assertEquals(movement.getResultingQuantity(), movement.getPreviousQuantity() + movement.getQuantityChange());
        }
    }
    @Test void totalsAreDerivedAndLegacyProductQuantityIsNeverConvertedOrExposed() throws Exception {
        Inventory first = fixture(10);
        var second = warehouses.saveAndFlush(new Warehouse(null, "Second", "Other", 100));
        inventoryService.createInventory(new InventoryRequest(product.getId(), second.getId(), 7));
        assertEquals(17, products.findById(product.getId()).orElseThrow().getTotalStock());
        stock.move(first.getId(), MovementType.ISSUE, 2, "Dispatch");
        assertEquals(15, products.findById(product.getId()).orElseThrow().getTotalStock());
        assertEquals(777, products.findById(product.getId()).orElseThrow().getQuantity());
        Product unassigned = products.saveAndFlush(new Product(null, "Unassigned", "NONE", null, 999, null, null));
        assertEquals(0, products.findById(unassigned.getId()).orElseThrow().getTotalStock());
        var user = users.saveAndFlush(new User(null, "viewer@example.test", "unused", Role.ADMIN, true));
        var response = http("GET", "/api/products/" + product.getId(), null, jwt.generateToken(user));
        var json = tools.jackson.databind.json.JsonMapper.builder().build().readTree(response.body());
        assertEquals(15, json.get("totalStock").longValue()); assertNull(json.get("quantity"));
        var update = http("PUT", "/api/products/" + product.getId(), "{\"name\":\"Retained\",\"sku\":\"TEST-BOLT\",\"description\":\"Keep description\",\"quantity\":1,\"totalStock\":999,\"price\":12.50,\"category\":null}", jwt.generateToken(user));
        assertEquals(200, update.statusCode());
        Product saved = products.findById(product.getId()).orElseThrow();
        assertEquals(777, saved.getQuantity()); assertEquals(15, saved.getTotalStock()); assertNull(saved.getCategory());
        assertEquals("Keep description", saved.getDescription());
    }
    @Test void rejectsInvalidArithmeticAndAdjustmentReasonsWithoutWrites() {
        Inventory inventory = fixture(10);
        for (MovementType type : MovementType.values()) assertThrows(StockException.class, () -> stock.move(inventory.getId(), type, -1, "Count"));
        assertThrows(StockException.class, () -> stock.move(inventory.getId(), MovementType.RECEIVE, 0, null));
        assertThrows(StockException.class, () -> stock.move(inventory.getId(), MovementType.ISSUE, 11, null));
        assertThrows(StockException.class, () -> stock.move(inventory.getId(), MovementType.ADJUST, 5, "  "));
        assertThrows(StockException.class, () -> stock.move(inventory.getId(), MovementType.ADJUST, 5, "a"));
        assertThrows(StockException.class, () -> stock.move(inventory.getId(), MovementType.RECEIVE, Integer.MAX_VALUE, null));
        assertThrows(StockException.class, () -> stock.move(inventory.getId(), null, 1, "Count"));
        assertThrows(StockException.class, () -> stock.move(inventory.getId(), MovementType.ADJUST, null, "Count"));
        assertEquals(10, inventories.findById(inventory.getId()).orElseThrow().getQuantity()); assertEquals(1, movements.count());
    }
    @Test void stockAndMovementRollbackTogetherWhenMovementInsertFails() throws Exception {
        Inventory inventory = fixture(10);
        try (var connection = dataSource.getConnection(); var sql = connection.createStatement()) {
            sql.execute("CREATE TRIGGER reject_test_movement BEFORE INSERT ON stock_movement FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Isolated rollback test'");
            try { assertThrows(RuntimeException.class, () -> stock.move(inventory.getId(), MovementType.RECEIVE, 3, "Delivery")); }
            finally { sql.execute("DROP TRIGGER reject_test_movement"); }
        }
        assertEquals(10, inventories.findById(inventory.getId()).orElseThrow().getQuantity()); assertEquals(1, movements.count());
    }
    @Test void concurrentReceiptsSerializeWithContinuousHistory() throws Exception {
        Inventory inventory = fixture(0);
        CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            List<Future<?>> jobs = new ArrayList<>();
            for (int worker = 0; worker < 2; worker++) {
                final int number = worker;
                jobs.add(pool.submit(() -> { authenticate("worker" + number + "@example.test");
                    try { start.await(); for (int i = 0; i < 10; i++) stock.move(inventory.getId(), MovementType.RECEIVE, 1, "Delivery"); }
                    catch (InterruptedException failure) { throw new RuntimeException(failure); }
                    finally { SecurityContextHolder.clearContext(); }
                }));
            }
            start.countDown(); for (var job : jobs) job.get(15, TimeUnit.SECONDS);
        }
        assertEquals(20, inventories.findById(inventory.getId()).orElseThrow().getQuantity());
        var history = new ArrayList<>(stock.history(inventory.getId())); Collections.reverse(history);
        assertEquals(20, history.size());
        for (int i = 0; i < 20; i++) { assertEquals(i, history.get(i).getPreviousQuantity()); assertEquals(i + 1, history.get(i).getResultingQuantity()); }
    }
    @Test void legacyMutationsCannotBypassOrDestroyHistory() {
        Inventory inventory = fixture(5);
        assertThrows(StockException.class, () -> inventoryService.updateInventory(inventory.getId(), new InventoryRequest(product.getId(), warehouse.getId(), 8)));
        InventoryQuantityRequest request = new InventoryQuantityRequest(0); request.setReason("Count correction");
        inventoryService.updateQuantity(inventory.getId(), request);
        assertEquals(2, movements.count());
        assertThrows(StockException.class, () -> inventoryService.deleteInventory(inventory.getId()));
        var other = warehouses.saveAndFlush(new Warehouse(null, "Other", "Elsewhere", 20));
        assertThrows(StockException.class, () -> inventoryService.updateInventory(inventory.getId(), new InventoryRequest(product.getId(), other.getId(), 0)));
        assertEquals(warehouse.getId(), inventories.findById(inventory.getId()).orElseThrow().getWarehouse().getId());
        assertEquals(2, movements.count());
    }
    @Test void zeroInventoryWithoutHistoryCanBeReassignedAndDeletedAndMissingIs404() {
        Inventory inventory = fixture(0);
        var other = warehouses.saveAndFlush(new Warehouse(null, "Other", "Elsewhere", 20));
        inventoryService.updateInventory(inventory.getId(), new InventoryRequest(product.getId(), other.getId(), 0));
        inventoryService.deleteInventory(inventory.getId()); assertFalse(inventories.existsById(inventory.getId()));
        assertEquals(0, movements.count());
        assertEquals(404, assertThrows(StockException.class, () -> inventoryService.deleteInventory(999L)).getStatus());
    }
    @ParameterizedTest @EnumSource(Role.class)
    void allRolesCanUseMovementEndpointsAndActorCannotBeSpoofed(Role role) throws Exception {
        Inventory inventory = fixture(0);
        var user = users.saveAndFlush(new User(null, "role-" + role.name() + "@example.test", "unused", role, true));
        String token = jwt.generateToken(user);
        var response = http("POST", "/api/inventory/" + inventory.getId() + "/movements", "{\"type\":\"RECEIVE\",\"quantity\":3,\"reason\":\"Delivery\",\"actor\":\"spoof@example.test\"}", token);
        assertEquals(200, response.statusCode());
        assertEquals(user.getEmail(), stock.history(inventory.getId()).get(0).getActor());
        var responseHistory = http("GET", "/api/inventory/" + inventory.getId() + "/movements", null, token);
        assertEquals(200, responseHistory.statusCode());
        var row = tools.jackson.databind.json.JsonMapper.builder().build().readTree(responseHistory.body()).get(0);
        assertEquals(9, row.size()); assertNull(row.get("inventory")); assertNull(row.get("user"));
        var conflict = http("POST", "/api/inventory/" + inventory.getId() + "/movements", "{\"type\":\"ISSUE\",\"quantity\":4}", token);
        assertEquals(409, conflict.statusCode());
        assertTrue(conflict.body().contains("INSUFFICIENT_STOCK")); assertFalse(conflict.body().contains("SQLException"));
        assertEquals(401, http("POST", "/api/inventory/" + inventory.getId() + "/movements", "{}", null).statusCode());
    }
    @ParameterizedTest @ValueSource(strings = {"{}", "null", "[]", "{\"type\":\"RECEIVE\",\"quantity\":1.5}", "{\"type\":\"RECEIVE\",\"quantity\":\"2\"}", "{\"type\":\"RECEIVE\",\"quantity\":2147483648}", "{\"type\":\"ADJUST\",\"quantity\":0}", "{\"type\":\"RECEIVE\",\"quantity\":-1}", "{\"type\":\"OTHER\",\"quantity\":1}"})
    void httpRejectsInvalidStockRequests(String body) throws Exception {
        Inventory inventory = fixture(0);
        var user = users.saveAndFlush(new User(null, "caller@example.test", "unused", Role.EMPLOYEE, true));
        assertEquals(400, http("POST", "/api/inventory/" + inventory.getId() + "/movements", body, jwt.generateToken(user)).statusCode());
        assertEquals(0, movements.count());
    }
    @Test void demoSeedIsIdempotentAndConsistentAndAllRolesAuthenticate() throws Exception {
        Path root = Files.createTempDirectory("lagermanager-demo-accounts-test-");
        Files.writeString(root.resolve(".gitignore"), "/DEV_TEST_ACCOUNTS.local.md\n");
        try {
            seeder.seed(root);
            byte[] original = Files.readAllBytes(root.resolve("DEV_TEST_ACCOUNTS.local.md"));
            assertEquals(12, products.count()); assertEquals(3, warehouses.count()); assertEquals(18, inventories.count()); assertEquals(28, movements.count()); assertEquals(3, users.count());
            assertEquals(4, inventories.findAll().stream().filter(i -> i.getQuantity() == 0).count());
            assertEquals(3, products.findAll().stream().filter(p -> inventories.findAll().stream().noneMatch(i -> i.getProduct().getId().equals(p.getId()))).count());
            for (Inventory inventory : inventories.findAll()) {
                var history = new ArrayList<>(stock.history(inventory.getId())); Collections.reverse(history); int previous = 0;
                for (var movement : history) { assertEquals(previous, movement.getPreviousQuantity()); previous = movement.getResultingQuantity(); }
                assertEquals(inventory.getQuantity(), previous);
                for (var row : history) assertTrue(users.findByEmail(row.getActor()).isPresent());
            }
            for (Product product : products.findAll()) assertEquals(inventories.findAll().stream().filter(i -> i.getProduct().getId().equals(product.getId())).mapToLong(Inventory::getQuantity).sum(), product.getTotalStock());
            for (String line : Files.readAllLines(root.resolve("DEV_TEST_ACCOUNTS.local.md"))) {
                if (!line.startsWith("| ADMIN |") && !line.startsWith("| MANAGER |") && !line.startsWith("| EMPLOYEE |")) continue;
                String[] fields = line.split("\\|");
                String body = tools.jackson.databind.json.JsonMapper.builder().build().writeValueAsString(Map.of("email", fields[2].trim(), "password", fields[3].trim()));
                var response = http("POST", "/api/auth/login", body, null);
                assertTrue(response.statusCode() == 200, "Demo role authentication must succeed");
                var json = tools.jackson.databind.json.JsonMapper.builder().build().readTree(response.body());
                var me = http("GET", "/api/auth/me", null, json.get("token").asString());
                assertTrue(me.statusCode() == 200); assertTrue(me.body().contains(fields[1].trim()));
            }
            Inventory changed = inventories.findAll().get(0); stock.move(changed.getId(), MovementType.RECEIVE, 2, "Manual test receipt");
            seeder.seed(root);
            assertTrue(Arrays.equals(original, Files.readAllBytes(root.resolve("DEV_TEST_ACCOUNTS.local.md"))), "Credential file must remain unchanged");
            assertEquals(12, products.count()); assertEquals(18, inventories.count()); assertEquals(29, movements.count());
            assertEquals(changed.getQuantity() + 2, inventories.findById(changed.getId()).orElseThrow().getQuantity());
        } finally { Files.deleteIfExists(root.resolve("DEV_TEST_ACCOUNTS.local.md")); Files.deleteIfExists(root.resolve(".gitignore")); Files.deleteIfExists(root); }
    }
    @Test void seederMergesAlongsideUnrelatedExistingRecordsWithoutChangingThem() throws Exception {
        Inventory existing = fixture(5);
        Path root = demoResetRoot();
        try {
            var originalMovement = stock.history(existing.getId()).get(0);
            var result = seeder.seed(root);
            assertEquals(12, result.insertedProducts()); assertEquals(3, result.insertedWarehouses());
            assertEquals(18, result.insertedInventory()); assertEquals(28, result.insertedMovements());
            assertEquals(13, products.count()); assertEquals(4, warehouses.count()); assertEquals(19, inventories.count()); assertEquals(29, movements.count());
            assertEquals(5, inventories.findById(existing.getId()).orElseThrow().getQuantity());
            assertEquals(777, products.findById(product.getId()).orElseThrow().getQuantity());
            assertEquals(originalMovement.getId(), stock.history(existing.getId()).get(0).getId());
            assertEquals(1, stock.history(existing.getId()).size());
        } finally { deleteDemoResetRoot(root); }
    }
    @ParameterizedTest @ValueSource(strings = {"jdbc:mysql://localhost:3306/lagermanager_demo", "jdbc:mysql://localhost:3307/lagermanager", "", "jdbc:mysql://remote.example/lagermanager", "jdbc:mysql://localhost:3306/lagermanager_demo?createDatabaseIfNotExist=true"})
    void demoGuardRejectsUnsafeTargets(String url) { assertThrows(IllegalStateException.class, () -> DemoDatabase.validate(url)); }


    @Test void initialReceiptFailureRollsBackInventoryCreation() throws Exception {
        fixture(0);
        long count = inventories.count();
        try (var connection = dataSource.getConnection(); var sql = connection.createStatement()) {
            sql.execute("CREATE TRIGGER reject_initial_receipt BEFORE INSERT ON stock_movement FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Isolated initial receipt rollback'");
            try { assertThrows(RuntimeException.class, () -> inventoryService.createInventory(new InventoryRequest(product.getId(), warehouse.getId(), 3))); }
            finally { sql.execute("DROP TRIGGER reject_initial_receipt"); }
        }
        assertEquals(count, inventories.count()); assertEquals(0, movements.count());
    }
    @Test void concurrentIssuesCannotOverdraw() throws Exception {
        Inventory inventory = fixture(1);
        CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            List<Future<Boolean>> jobs = new ArrayList<>();
            for (int i = 0; i < 2; i++) jobs.add(pool.submit(() -> {
                authenticate("dispatcher@example.test");
                try { start.await(); stock.move(inventory.getId(), MovementType.ISSUE, 1, "Dispatch"); return true; }
                catch (StockException conflict) { assertEquals("INSUFFICIENT_STOCK", conflict.getCode()); return false; }
                finally { SecurityContextHolder.clearContext(); }
            }));
            start.countDown(); int successes = 0; for (var job : jobs) if (job.get(10, TimeUnit.SECONDS)) successes++;
            assertEquals(1, successes);
        }
        assertEquals(0, inventories.findById(inventory.getId()).orElseThrow().getQuantity()); assertEquals(2, movements.count());
    }
    @Test void databaseForeignKeyPreservesHistoryAndNoHistoryMutationEndpointsExist() throws Exception {
        Inventory inventory = fixture(2);
        try (var connection = dataSource.getConnection(); var sql = connection.prepareStatement("DELETE FROM inventory WHERE id = ?")) {
            sql.setLong(1, inventory.getId()); assertThrows(java.sql.SQLException.class, sql::executeUpdate);
        }
        assertTrue(inventories.existsById(inventory.getId())); assertEquals(1, movements.count());
        var user = users.saveAndFlush(new User(null, "history-reader@example.test", "unused", Role.ADMIN, true));
        for (String method : List.of("PUT", "DELETE")) assertEquals(405, http(method, "/api/inventory/" + inventory.getId() + "/movements", "{}", jwt.generateToken(user)).statusCode());
        assertEquals(1, movements.count());
    }
    @Test void rejectsMissingAndUnauthenticatedStockAndLegacyOrphanWithoutHistory() {
        Inventory inventory = fixture(0);
        assertEquals(404, assertThrows(StockException.class, () -> stock.move(Long.MAX_VALUE, MovementType.RECEIVE, 1, "Delivery")).getStatus());
        SecurityContextHolder.clearContext();
        assertEquals(401, assertThrows(StockException.class, () -> stock.move(inventory.getId(), MovementType.RECEIVE, 1, "Delivery")).getStatus());
        authenticate("counter@example.test");
        Inventory orphan = inventories.saveAndFlush(new Inventory(null, null, warehouse, 0));
        assertEquals(409, assertThrows(StockException.class, () -> stock.move(orphan.getId(), MovementType.RECEIVE, 1, "Delivery")).getStatus());
        assertEquals(0, movements.count());
    }
    @Test void legacyPatchRequiresReasonAndRecordsServerActor() throws Exception {
        Inventory inventory = fixture(2);
        var user = users.saveAndFlush(new User(null, "adjuster@example.test", "unused", Role.EMPLOYEE, true));
        String token = jwt.generateToken(user);
        assertEquals(400, http("PATCH", "/api/inventory/" + inventory.getId() + "/quantity", "{\"quantity\":0}", token).statusCode());
        assertEquals(200, http("PATCH", "/api/inventory/" + inventory.getId() + "/quantity", "{\"quantity\":0,\"reason\":\"Cycle count\",\"actor\":\"untrusted@example.test\"}", token).statusCode());
        assertEquals(user.getEmail(), stock.history(inventory.getId()).get(0).getActor());
        assertEquals(2, movements.count());
    }


    @Test void seedRollsBackAllBusinessRowsAndPreservesCredentialsForSafeRetry() throws Exception {
        Path root = Files.createTempDirectory("lagermanager-demo-rollback-test-");
        Files.writeString(root.resolve(".gitignore"), "/DEV_TEST_ACCOUNTS.local.md\n");
        try {
            try (var connection = dataSource.getConnection(); var sql = connection.createStatement()) {
                sql.execute("CREATE TRIGGER reject_demo_receipt BEFORE INSERT ON stock_movement FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Isolated seed rollback'");
                try { assertThrows(RuntimeException.class, () -> seeder.seed(root)); }
                finally { sql.execute("DROP TRIGGER reject_demo_receipt"); }
            }
            assertEquals(0, users.count()); assertEquals(0, products.count()); assertEquals(0, inventories.count()); assertEquals(0, movements.count()); assertEquals(0, states.count());
            byte[] original = Files.readAllBytes(root.resolve("DEV_TEST_ACCOUNTS.local.md"));
            seeder.seed(root);
            assertTrue(Arrays.equals(original, Files.readAllBytes(root.resolve("DEV_TEST_ACCOUNTS.local.md"))), "Safe retry must reuse the same local credentials");
            assertEquals(28, movements.count());
        } finally { Files.deleteIfExists(root.resolve("DEV_TEST_ACCOUNTS.local.md")); Files.deleteIfExists(root.resolve(".gitignore")); Files.deleteIfExists(root); }
    }


    @Test void productCreationCannotWriteLegacyQuantityOrInventWarehouseStock() throws Exception {
        var user = users.saveAndFlush(new User(null, "metadata-admin@example.test", "unused", Role.ADMIN, true));
        var response = http("POST", "/api/products", "{\"id\":98765,\"name\":\"Unassigned\",\"sku\":\"NEW\",\"description\":null,\"category\":null,\"price\":null,\"quantity\":500,\"totalStock\":900}", jwt.generateToken(user));
        assertEquals(200, response.statusCode());
        var json = tools.jackson.databind.json.JsonMapper.builder().build().readTree(response.body());
        assertEquals(0, json.get("totalStock").longValue()); assertNull(json.get("quantity"));
        assertNotEquals(98765, json.get("id").longValue());
        assertEquals(0, products.findById(json.get("id").longValue()).orElseThrow().getQuantity());
        assertEquals(0, inventories.count()); assertEquals(0, movements.count());
    }


    @Test void legacyHttpCreationPatchPutAndDeleteCannotBypassHistory() throws Exception {
        fixture(0);
        var user = users.saveAndFlush(new User(null, "legacy-admin@example.test", "unused", Role.ADMIN, true));
        String token = jwt.generateToken(user);
        String associations = "\"productId\":" + product.getId() + ",\"warehouseId\":" + warehouse.getId();
        var created = http("POST", "/api/inventory", "{" + associations + ",\"quantity\":4,\"actor\":\"spoof@example.test\"}", token);
        assertEquals(200, created.statusCode());
        long id = tools.jackson.databind.json.JsonMapper.builder().build().readTree(created.body()).get("id").longValue();
        assertEquals(1, stock.history(id).size()); assertEquals(user.getEmail(), stock.history(id).get(0).getActor());
        assertEquals(409, http("PUT", "/api/inventory/" + id, "{" + associations + ",\"quantity\":7}", token).statusCode());
        assertEquals(200, http("PATCH", "/api/inventory/" + id + "/quantity", "{\"quantity\":0,\"reason\":\"Cycle count\"}", token).statusCode());
        var other = warehouses.saveAndFlush(new Warehouse(null, "Other", "Other location", 20));
        assertEquals(409, http("PUT", "/api/inventory/" + id, "{\"productId\":" + product.getId() + ",\"warehouseId\":" + other.getId() + ",\"quantity\":0}", token).statusCode());
        assertEquals(409, http("DELETE", "/api/inventory/" + id, null, token).statusCode());
        assertEquals(2, stock.history(id).size());
        assertEquals(warehouse.getId(), inventories.findById(id).orElseThrow().getWarehouse().getId());
    }


    @Test void explicitPasswordResetPreservesBusinessDataAndAllAccountIdentityFields() throws Exception {
        Path root = demoResetRoot();
        try {
            seeder.seed(root);
            List<User> original = users.findAll();
            String unrelatedHash = encoder.encode(UUID.randomUUID().toString());
            User unrelated = users.saveAndFlush(new User(null, "unrelated-demo@example.test", unrelatedHash, Role.MANAGER, true));
            Inventory changed = inventories.findAll().get(0);
            stock.move(changed.getId(), MovementType.RECEIVE, 2, "Manual demo receipt");
            String businessBefore = businessSnapshot();
            String originalToken = jwt.generateToken(original.get(0));
            String replacement = UUID.randomUUID().toString().substring(0, 9);
            replaceDemoFilePasswords(root, replacement);
            byte[] fileBefore = Files.readAllBytes(root.resolve("DEV_TEST_ACCOUNTS.local.md"));
            seeder.resetPasswords(root);
            for (User before : original) {
                User after = users.findByEmail(before.getEmail()).orElseThrow();
                assertEquals(before.getId(), after.getId()); assertEquals(before.getEmail(), after.getEmail());
                assertEquals(before.getRole(), after.getRole()); assertEquals(before.isEnabled(), after.isEnabled());
                assertTrue(encoder.matches(replacement, after.getPasswordHash()), "Demo hash must match the private file");
                assertFalse(before.getPasswordHash().equals(after.getPasswordHash()), "An explicit reset must replace an old mismatched hash");
                String body = tools.jackson.databind.json.JsonMapper.builder().build().writeValueAsString(Map.of("email", after.getEmail(), "password", replacement));
                assertTrue(http("POST", "/api/auth/login", body, null).statusCode() == 200, "Each demo role must authenticate after reset");
            }
            assertTrue(businessBefore.equals(businessSnapshot()), "Reset must preserve products, warehouses, inventory and complete movement history");
            assertTrue(unrelatedHash.equals(users.findById(unrelated.getId()).orElseThrow().getPasswordHash()), "Unrelated application account must stay unchanged");
            assertEquals(4, users.count());
            assertTrue(Arrays.equals(fileBefore, Files.readAllBytes(root.resolve("DEV_TEST_ACCOUNTS.local.md"))), "Reset must not rewrite the private account file");
            assertTrue(http("GET", "/api/auth/me", null, originalToken).statusCode() == 200, "The existing signing key must remain unchanged");
            Map<Long, String> hashes = new HashMap<>(); for (User user : users.findAll()) hashes.put(user.getId(), user.getPasswordHash());
            seeder.resetPasswords(root); seeder.seed(root);
            for (User user : users.findAll()) assertTrue(hashes.get(user.getId()).equals(user.getPasswordHash()), "Repeating reset must not rehash matching passwords");
            assertTrue(businessBefore.equals(businessSnapshot()), "Neither reset nor repeated seed may change business data");
        } finally { deleteDemoResetRoot(root); }
    }

    @Test void firstSeedUsesConfiguredNineCharacterPasswordsAndResetDoesNotRestoreRolesOrEnabledState() throws Exception {
        Path root = demoResetRoot();
        try {
            String configured = UUID.randomUUID().toString().substring(0, 9);
            StringBuilder file = new StringBuilder("# Private isolated demo accounts\n\nDemo setup ID: " + UUID.randomUUID() + "\n");
            for (Role role : Role.values()) file.append("| ").append(role.name()).append(" | demo-").append(role.name().toLowerCase()).append("@lagermanager.test | ").append(configured).append(" |\n");
            Files.writeString(root.resolve("DEV_TEST_ACCOUNTS.local.md"), file);
            seeder.seed(root);
            for (User user : users.findAll()) assertTrue(encoder.matches(configured, user.getPasswordHash()), "First seed must use the configured private password");
            User manager = users.findByEmail("demo-manager@lagermanager.test").orElseThrow();
            manager.setRole(Role.EMPLOYEE); manager.setEnabled(false); users.saveAndFlush(manager);
            replaceDemoFilePasswords(root, UUID.randomUUID().toString().substring(0, 9));
            seeder.resetPasswords(root);
            User after = users.findById(manager.getId()).orElseThrow();
            assertEquals(Role.EMPLOYEE, after.getRole()); assertFalse(after.isEnabled());
        } finally { deleteDemoResetRoot(root); }
    }

    @Test void passwordResetRollsBackAllThreeHashesIfOneUpdateFails() throws Exception {
        Path root = demoResetRoot();
        try {
            seeder.seed(root);
            Map<Long, String> hashes = new HashMap<>(); for (User user : users.findAll()) hashes.put(user.getId(), user.getPasswordHash());
            String businessBefore = businessSnapshot();
            replaceDemoFilePasswords(root, UUID.randomUUID().toString().substring(0, 9));
            try (var connection = dataSource.getConnection(); var sql = connection.createStatement()) {
                sql.execute("CREATE TRIGGER reject_demo_password_reset BEFORE UPDATE ON app_users FOR EACH ROW BEGIN IF NEW.email = 'demo-employee@lagermanager.test' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Isolated password reset rollback'; END IF; END");
                try { assertThrows(RuntimeException.class, () -> seeder.resetPasswords(root)); }
                finally { sql.execute("DROP TRIGGER reject_demo_password_reset"); }
            }
            for (User user : users.findAll()) assertTrue(hashes.get(user.getId()).equals(user.getPasswordHash()), "A failed reset must roll back every hash");
            assertTrue(businessBefore.equals(businessSnapshot()), "A failed reset must leave business data intact");
        } finally { deleteDemoResetRoot(root); }
    }

    @Test void passwordResetNeverSeedsAnEmptyDatabaseOrRecreatesMissingUsers() throws Exception {
        Path root = demoResetRoot();
        try {
            assertThrows(IllegalStateException.class, () -> seeder.resetPasswords(root));
            assertEquals(0, users.count()); assertEquals(0, products.count());
            assertFalse(Files.exists(root.resolve("DEV_TEST_ACCOUNTS.local.md")));
            seeder.seed(root);
            User removed = users.findByEmail("demo-employee@lagermanager.test").orElseThrow(); users.delete(removed);
            Map<Long, String> hashes = new HashMap<>(); for (User user : users.findAll()) hashes.put(user.getId(), user.getPasswordHash());
            String businessBefore = businessSnapshot();
            replaceDemoFilePasswords(root, UUID.randomUUID().toString().substring(0, 9));
            assertThrows(IllegalStateException.class, () -> seeder.resetPasswords(root));
            assertEquals(2, users.count());
            for (User user : users.findAll()) assertTrue(hashes.get(user.getId()).equals(user.getPasswordHash()), "Missing-account refusal must not change other hashes");
            assertTrue(businessBefore.equals(businessSnapshot()));
        } finally { deleteDemoResetRoot(root); }
    }

    private Path demoResetRoot() throws Exception {
        Path root = Files.createTempDirectory("lagermanager-demo-reset-test-");
        Files.writeString(root.resolve(".gitignore"), "/DEV_TEST_ACCOUNTS.local.md\n");
        return root;
    }
    private void deleteDemoResetRoot(Path root) throws Exception {
        Files.deleteIfExists(root.resolve("DEV_TEST_ACCOUNTS.local.md")); Files.deleteIfExists(root.resolve(".gitignore")); Files.deleteIfExists(root);
    }
    private void replaceDemoFilePasswords(Path root, String password) throws Exception {
        List<String> updated = new ArrayList<>();
        for (String line : Files.readAllLines(root.resolve("DEV_TEST_ACCOUNTS.local.md"))) {
            if (line.startsWith("| ADMIN | ") || line.startsWith("| MANAGER | ") || line.startsWith("| EMPLOYEE | ")) {
                String[] columns = line.split("\\|", -1); columns[3] = " " + password + " "; line = String.join("|", columns);
            }
            updated.add(line);
        }
        Files.write(root.resolve("DEV_TEST_ACCOUNTS.local.md"), updated);
    }
    private String businessSnapshot() throws Exception {
        return tools.jackson.databind.json.JsonMapper.builder().build().writeValueAsString(Map.of(
                "products", products.findAll(), "warehouses", warehouses.findAll(), "inventory", inventories.findAll(), "movements", movements.findAll()));
    }


    @Test void populationAdoptsClearlyMatchingRowsWithoutFabricatingHistoryAndPreservesLaterEdits() throws Exception {
        Product matchingProduct = products.saveAndFlush(new Product(null, "Steel hex bolts M8", "FAST-M8-100", "Demo steel hex bolts m8", 123, new BigDecimal("8.90"), "Fasteners"));
        Warehouse matchingWarehouse = warehouses.saveAndFlush(new Warehouse(null, "North distribution", "Hamburg · Dock A", 12000));
        Inventory legacy = inventories.saveAndFlush(new Inventory(null, matchingProduct, matchingWarehouse, 55));
        String unrelatedHash = encoder.encode(UUID.randomUUID().toString());
        User unrelated = users.saveAndFlush(new User(null, "unrelated@example.test", unrelatedHash, Role.EMPLOYEE, false));
        Path root = demoResetRoot();
        try {
            var first = seeder.seed(root);
            assertEquals(11, first.insertedProducts()); assertEquals(1, first.reusedProducts());
            assertEquals(2, first.insertedWarehouses()); assertEquals(1, first.reusedWarehouses());
            assertEquals(17, first.insertedInventory()); assertEquals(1, first.reusedInventory());
            assertEquals(55, inventories.findById(legacy.getId()).orElseThrow().getQuantity());
            assertTrue(stock.history(legacy.getId()).isEmpty());
            assertEquals(123, products.findById(matchingProduct.getId()).orElseThrow().getQuantity());
            assertEquals(33, seedRecords.count());
            assertTrue(unrelatedHash.equals(users.findById(unrelated.getId()).orElseThrow().getPasswordHash()));
            matchingProduct.setName("Manually edited title"); products.saveAndFlush(matchingProduct);
            matchingWarehouse.setCapacity(15000); warehouses.saveAndFlush(matchingWarehouse);
            stock.move(legacy.getId(), MovementType.RECEIVE, 2, "Manual receipt");
            String before = businessSnapshot();
            var second = seeder.seed(root);
            assertEquals(0, second.insertedProducts()); assertEquals(12, second.reusedProducts());
            assertEquals(0, second.insertedWarehouses()); assertEquals(3, second.reusedWarehouses());
            assertEquals(0, second.insertedInventory()); assertEquals(18, second.reusedInventory());
            assertEquals(0, second.insertedMovements());
            assertTrue(before.equals(businessSnapshot()), "Repeat population must not reset manual changes");
        } finally { deleteDemoResetRoot(root); }
    }
    @Test void populationDoesNotRecreateManuallyDeletedTrackedRows() throws Exception {
        Path root = demoResetRoot();
        try {
            seeder.seed(root);
            Product unassigned = products.findAllBySku("TOOL-TAPE-5").get(0); products.delete(unassigned);
            Inventory empty = inventories.findAll().stream().filter(i -> i.getQuantity() == 0).findFirst().orElseThrow();
            inventoryService.deleteInventory(empty.getId());
            var repeat = seeder.seed(root);
            assertEquals(1, repeat.missingProducts()); assertEquals(1, repeat.missingInventory());
            assertEquals(0, repeat.insertedProducts()); assertEquals(0, repeat.insertedInventory()); assertEquals(0, repeat.insertedMovements());
            assertEquals(11, products.count()); assertEquals(17, inventories.count()); assertEquals(28, movements.count());
        } finally { deleteDemoResetRoot(root); }
    }
    @Test void populationRefusesAmbiguousOrConflictingProductIdentityWithoutOverwriting() throws Exception {
        Product conflict = products.saveAndFlush(new Product(null, "Unrelated existing item", "FAST-M8-100", null, 456, BigDecimal.ONE, null));
        Path root = demoResetRoot();
        try {
            assertThrows(IllegalStateException.class, () -> seeder.seed(root));
            assertEquals(1, products.count()); assertEquals(0, users.count()); assertEquals(0, seedRecords.count());
            assertEquals("Unrelated existing item", products.findById(conflict.getId()).orElseThrow().getName());
            assertEquals(456, products.findById(conflict.getId()).orElseThrow().getQuantity());
        } finally { deleteDemoResetRoot(root); }
    }
    @Test void populationUpdatesOnlyAllowlistedAccountCredentialsRolesAndEnabledState() throws Exception {
        Map<String, Long> ids = new HashMap<>();
        for (Role role : Role.values()) {
            User user = users.saveAndFlush(new User(null, "demo-" + role.name().toLowerCase() + "@lagermanager.test", encoder.encode(UUID.randomUUID().toString()), Role.EMPLOYEE, false));
            ids.put(user.getEmail(), user.getId());
        }
        Path root = demoResetRoot();
        try {
            var result = seeder.seed(root); assertEquals(0, result.insertedAccounts()); assertEquals(3, result.updatedAccounts());
            for (Role role : Role.values()) {
                User user = users.findByEmail("demo-" + role.name().toLowerCase() + "@lagermanager.test").orElseThrow();
                assertEquals(ids.get(user.getEmail()), user.getId()); assertEquals(role, user.getRole()); assertTrue(user.isEnabled());
            }
            Map<Long, String> hashes = new HashMap<>(); for (User user : users.findAll()) hashes.put(user.getId(), user.getPasswordHash());
            var repeat = seeder.seed(root); assertEquals(3, repeat.reusedAccounts()); assertEquals(0, repeat.updatedAccounts());
            for (User user : users.findAll()) assertTrue(hashes.get(user.getId()).equals(user.getPasswordHash()), "Repeat population must not rotate matching hashes");
        } finally { deleteDemoResetRoot(root); }
    }

    private HttpResponse<String> http(String method, String path, String body, String token) throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).header("Content-Type", "application/json");
            if (token != null) request.header("Authorization", "Bearer " + token);
            return client.send(request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
        }
    }
}
