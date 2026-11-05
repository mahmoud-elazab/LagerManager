package com.lagermanager.lowstock;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.lagermanager.inventory.Inventory;
import com.lagermanager.inventory.InventoryRepository;
import com.lagermanager.product.Product;
import com.lagermanager.product.ProductRepository;
import com.lagermanager.stock.MovementType;
import com.lagermanager.stock.StockMovement;
import com.lagermanager.stock.StockMovementRepository;
import com.lagermanager.support.DisposableMySql;
import com.lagermanager.warehouse.Warehouse;
import com.lagermanager.warehouse.WarehouseRepository;
import io.jsonwebtoken.Jwts;
import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.ScheduledAnnotationBeanPostProcessor;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import javax.sql.DataSource;
import java.math.BigDecimal;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties = "spring.jpa.properties.hibernate.generate_statistics=true")
@org.springframework.test.context.ActiveProfiles("test")
@EnabledIf("com.lagermanager.support.DisposableMySql#isAvailable")
class LowStockPersistenceTests {
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        DisposableMySql.configure(registry, "lagermanager_low_stock_test");
        String secret = Base64.getEncoder().encodeToString(Jwts.SIG.HS256.key().build().getEncoded());
        registry.add("LAGERMANAGER_JWT_SECRET", () -> secret);
    }

    @Autowired LowStockCheck check;
    @Autowired ProductRepository products;
    @Autowired InventoryRepository inventories;
    @Autowired WarehouseRepository warehouses;
    @Autowired StockMovementRepository movements;
    @Autowired ApplicationContext context;
    @Autowired DataSource dataSource;
    @Autowired EntityManagerFactory entityManagerFactory;
    Warehouse first;
    Warehouse second;

    @BeforeEach void setup() {
        movements.deleteAllInBatch();
        inventories.deleteAllInBatch();
        products.deleteAllInBatch();
        warehouses.deleteAllInBatch();
        first = warehouses.saveAndFlush(new Warehouse(null, "First test depot", "Disposable", 100));
        second = warehouses.saveAndFlush(new Warehouse(null, "Second test depot", "Disposable", 100));
    }

    @Test void reportsBelowAtAndZeroButNotAboveUsingTotalsAcrossWarehousesWithoutWrites() {
        Product below = fixture("Below", 2, 2);
        Product at = fixture("At", 3, 2);
        fixture("Above", 3, 3); // Each warehouse alone is below the threshold; the total is above it.
        Product zero = fixture("Zero", 0, 0);
        Product unassigned = products.saveAndFlush(product("Unassigned"));
        Inventory existing = inventories.findAll().stream().filter(i -> i.getProduct().getId().equals(below.getId())).findFirst().orElseThrow();
        movements.saveAndFlush(new StockMovement(existing, MovementType.RECEIVE, 2, 0, 2,
                "fixture@example.test", "Existing disposable history"));
        var before = snapshot();
        var stats = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        stats.clear();
        Logger logger = (Logger) LoggerFactory.getLogger(LowStockCheck.class);
        var logs = new ListAppender<ILoggingEvent>();
        logs.start(); logger.addAppender(logs);
        try {
            var result = check.check(5); // Direct invocation, no scheduler wait.
            assertEquals(Map.of(below.getId(), 4L, at.getId(), 5L, zero.getId(), 0L, unassigned.getId(), 0L),
                    result.stream().collect(Collectors.toMap(LowStockCheck.ProductStock::id, LowStockCheck.ProductStock::totalStock)));
            assertEquals(1, logs.list.size());
            String message = logs.list.get(0).getFormattedMessage();
            assertTrue(message.contains("threshold=5, matched=4"));
            assertTrue(message.contains("name=Below, totalStock=4"));
            assertTrue(message.contains("name=At, totalStock=5"));
            assertTrue(message.contains("name=Zero, totalStock=0"));
            assertTrue(message.contains("name=Unassigned, totalStock=0"));
            assertFalse(message.contains("name=Above"));
            assertEquals(ch.qos.logback.classic.Level.INFO, logs.list.get(0).getLevel());
        } finally { logger.detachAppender(logs); logs.stop(); }
        assertEquals(before, snapshot());
        assertEquals(0, stats.getEntityInsertCount());
        assertEquals(0, stats.getEntityUpdateCount());
        assertEquals(0, stats.getEntityDeleteCount());
    }

    @Test void zeroThresholdIncludesBothZeroInventoryAndNoInventory() {
        Product zero = fixture("Zero", 0, 0);
        Product unassigned = products.saveAndFlush(product("Unassigned"));
        fixture("Positive", 1, 0);
        assertEquals(Map.of(zero.getId(), 0L, unassigned.getId(), 0L), check.check(0).stream()
                .collect(Collectors.toMap(LowStockCheck.ProductStock::id, LowStockCheck.ProductStock::totalStock)));
    }

    @Test void largeTotalsUseLongArithmeticAndAreFreshOnEachCheck() {
        Product product = fixture("Large", Integer.MAX_VALUE, Integer.MAX_VALUE);
        assertTrue(check.check(Integer.MAX_VALUE).isEmpty());
        assertEquals(4_294_967_294L, check.check(4_294_967_294L).get(0).totalStock());
        // Fixture-only update between runs proves the check does not cache old totals.
        Inventory inventory = inventories.findAll().get(0);
        inventory.setQuantity(0); inventories.saveAndFlush(inventory);
        assertEquals((long) Integer.MAX_VALUE, check.check(Integer.MAX_VALUE).get(0).totalStock());
        assertEquals(product.getId(), check.check(Integer.MAX_VALUE).get(0).id());
    }

    @Test void emptyDatabaseStillLogsASummary() {
        Logger logger = (Logger) LoggerFactory.getLogger(LowStockCheck.class);
        var logs = new ListAppender<ILoggingEvent>();
        logs.start(); logger.addAppender(logs);
        try {
            assertEquals(List.of(), check.check(5));
            assertEquals(1, logs.list.size());
            assertEquals("Low-stock check: threshold=5, matched=0, products=[]", logs.list.get(0).getFormattedMessage());
        } finally { logger.detachAppender(logs); logs.stop(); }
    }

    @Test void defaultApplicationSettingsDoNotEnableScheduling() {
        assertFalse(context.getEnvironment().getProperty("lagermanager.low-stock.enabled", Boolean.class));
        assertTrue(context.getBeansOfType(LowStockJob.class).isEmpty());
        assertTrue(context.getBeansOfType(ScheduledAnnotationBeanPostProcessor.class).isEmpty());
    }

    @Test void negativeThresholdIsRejectedWithoutChanges() {
        fixture("Retained", 1, 2);
        var before = snapshot();
        assertThrows(IllegalArgumentException.class, () -> check.check(-1));
        assertEquals(before, snapshot());
    }

    private Product product(String name) {
        return new Product(null, name, "LOW-" + name, "Disposable low-stock fixture", 777, new BigDecimal("1.00"), null);
    }
    private Product fixture(String name, int one, int two) {
        Product product = products.saveAndFlush(product(name));
        inventories.saveAndFlush(new Inventory(null, product, first, one));
        inventories.saveAndFlush(new Inventory(null, product, second, two));
        return product;
    }
    private Map<String, List<Map<String, Object>>> snapshot() {
        var jdbc = new JdbcTemplate(dataSource);
        var rows = new LinkedHashMap<String, List<Map<String, Object>>>();
        for (String table : List.of("product", "warehouse", "inventory", "stock_movement")) {
            rows.put(table, jdbc.queryForList("SELECT * FROM " + table + " ORDER BY id"));
        }
        return rows;
    }
}
