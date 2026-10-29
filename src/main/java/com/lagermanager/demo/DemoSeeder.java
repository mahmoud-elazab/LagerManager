package com.lagermanager.demo;

import com.lagermanager.inventory.*;
import com.lagermanager.product.*;
import com.lagermanager.stock.*;
import com.lagermanager.user.*;
import com.lagermanager.warehouse.*;
import org.springframework.stereotype.Service;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import javax.sql.DataSource;
import java.math.BigDecimal;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.util.*;

@Service
public class DemoSeeder {
    private final DataSource dataSource;
    private final TransactionTemplate transaction;
    private final ProductRepository products;
    private final WarehouseRepository warehouses;
    private final InventoryRepository inventories;
    private final StockMovementRepository movements;
    private final InventoryService inventoryService;
    private final StockService stock;
    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final DemoSeedStateRepository states;
    private final DemoSeedRecordRepository records;

    public DemoSeeder(DataSource dataSource, PlatformTransactionManager manager, ProductRepository products,
                      WarehouseRepository warehouses, InventoryRepository inventories, StockMovementRepository movements,
                      InventoryService inventoryService, StockService stock, UserRepository users,
                      PasswordEncoder encoder, DemoSeedStateRepository states, DemoSeedRecordRepository records) {
        this.dataSource = dataSource; this.transaction = new TransactionTemplate(manager);
        this.transaction.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.products = products; this.warehouses = warehouses; this.inventories = inventories;
        this.movements = movements; this.inventoryService = inventoryService; this.stock = stock;
        this.users = users; this.encoder = encoder; this.states = states; this.records = records;
    }

    private record Account(Role role, String email, String password) { }
    private record Accounts(String id, List<Account> values) { }

    public record PopulationResult(int insertedProducts, int reusedProducts, int missingProducts,
            int insertedWarehouses, int reusedWarehouses, int missingWarehouses,
            int insertedInventory, int reusedInventory, int missingInventory, int insertedMovements,
            int insertedAccounts, int updatedAccounts, int reusedAccounts) { }
    private static class Counts {
        int products, reusedProducts, missingProducts, warehouses, reusedWarehouses, missingWarehouses;
        int inventory, reusedInventory, missingInventory, movements, accounts, updatedAccounts, reusedAccounts;
        PopulationResult result() { return new PopulationResult(products, reusedProducts, missingProducts,
                warehouses, reusedWarehouses, missingWarehouses, inventory, reusedInventory, missingInventory,
                movements, accounts, updatedAccounts, reusedAccounts); }
    }

    public PopulationResult seed(Path root) { return withDemoLock(root, false); }

    /** Explicit local-only reset; never creates accounts or invokes business-data population. */
    public void resetPasswords(Path root) { withDemoLock(root, true); }

    private PopulationResult withDemoLock(Path root, boolean resetPasswords) {
        try (var connection = dataSource.getConnection()) {
            DemoDatabase.validate(connection.getMetaData().getURL());
            if (!Set.of("lagermanager", "lagermanager_demo_test").contains(connection.getCatalog())) {
                throw new IllegalStateException("Refusing non-demo catalog.");
            }
            // Serialize seed attempts across processes; hold this dedicated connection through transaction commit.
            try (var lock = connection.prepareStatement("SELECT GET_LOCK(?, 10)")) {
                lock.setString(1, "lagermanager-demo-seed-" + connection.getCatalog());
                try (var result = lock.executeQuery()) {
                    if (!result.next() || result.getInt(1) != 1) throw new IllegalStateException("Another demo setup is running. Try again later.");
                }
            }
            try {
                if (!Files.readAllLines(root.resolve(".gitignore")).contains("/DEV_TEST_ACCOUNTS.local.md")) {
                    throw new IllegalStateException("Ignore DEV_TEST_ACCOUNTS.local.md before generating demo accounts.");
                }
                return transaction.execute(status -> {
                    if (resetPasswords) { resetExistingPasswords(root); return null; }
                    return populate(root);
                });
            } finally {
                try (var unlock = connection.prepareStatement("SELECT RELEASE_LOCK(?)")) {
                    unlock.setString(1, "lagermanager-demo-seed-" + connection.getCatalog()); unlock.execute();
                }
            }
        } catch (RuntimeException failure) { throw failure; }
        catch (Exception failure) { throw new IllegalStateException("Demo setup could not complete safely. Check the authorized local database and private account file."); }
    }

    private void resetExistingPasswords(Path root) {
        var state = states.findById("local-demo-v1")
                .orElseThrow(() -> new IllegalStateException("Demo has not been seeded. Password reset does not create or reseed data."));
        Path file = root.resolve("DEV_TEST_ACCOUNTS.local.md");
        if (!Files.isRegularFile(file)) throw new IllegalStateException("The original private demo account file is required for password reset.");
        Accounts accounts = accounts(file);
        if (!state.getAccountFileId().equals(accounts.id())) throw new IllegalStateException("Local account file belongs to a different demo setup.");
        // Lock and validate every target before changing anything. The allowlisted emails come from the original seed file.
        List<User> targets = new ArrayList<>();
        for (Account account : accounts.values()) {
            targets.add(users.findByEmailForUpdate(account.email())
                    .orElseThrow(() -> new IllegalStateException("A seeded demo account is missing. No accounts were created or reset.")));
        }
        for (int i = 0; i < targets.size(); i++) {
            User user = targets.get(i);
            String password = accounts.values().get(i).password();
            if (!encoder.matches(password, user.getPasswordHash())) user.setPasswordHash(encoder.encode(password));
        }
        users.flush(); // Managed dirty checking, inside one transaction; IDs, roles and enabled state stay unchanged.
    }

    private PopulationResult populate(Path root) {
        Counts counts = new Counts();
        var state = states.findById("local-demo-v1");
        Path file = root.resolve("DEV_TEST_ACCOUNTS.local.md");
        if (state.isPresent() && !Files.isRegularFile(file)) throw new IllegalStateException("The original private demo account file is required.");
        Accounts accounts = accounts(file);
        if (state.isPresent() && !state.get().getAccountFileId().equals(accounts.id())) {
            throw new IllegalStateException("Local account file belongs to a different demo setup. Nothing was overwritten.");
        }
        // Only these three allowlisted application accounts are created/updated, never unrelated accounts.
        for (Account account : accounts.values()) {
            var found = users.findByEmailForUpdate(account.email());
            if (found.isEmpty()) {
                users.saveAndFlush(new User(null, account.email(), encoder.encode(account.password()), account.role(), true));
                counts.accounts++;
            } else {
                User user = found.get();
                boolean changed = user.getRole() != account.role() || !user.isEnabled()
                        || !encoder.matches(account.password(), user.getPasswordHash());
                if (changed) {
                    if (!encoder.matches(account.password(), user.getPasswordHash())) user.setPasswordHash(encoder.encode(account.password()));
                    user.setRole(account.role()); user.setEnabled(true); counts.updatedAccounts++;
                } else counts.reusedAccounts++;
            }
        }
        users.flush();
        var previous = SecurityContextHolder.getContext();
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(accounts.values().get(0).email(), null,
                List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_ADMIN"))));
        SecurityContextHolder.setContext(context);
        try {
            String[][] data = {
                {"Steel hex bolts M8", "FAST-M8-100", "Fasteners", "8.90"},
                {"Stainless washers M8", "FAST-W8-100", "Fasteners", "4.20"},
                {"Heavy-duty shelving bracket", "SHELF-BR-01", "Storage", "12.50"},
                {"Stackable storage bin 30L", "BIN-30-GR", "Storage", "18.75"},
                {"Packing tape 48mm", "PACK-TAPE-48", "Packaging", "2.80"},
                {"Shipping carton medium", "PACK-BOX-M", "Packaging", "1.45"},
                {"Nitrile work gloves", "SAFE-GLV-L", "Safety", "6.40"},
                {"High-visibility vest", "SAFE-VEST-Y", "Safety", "9.90"},
                {"Utility knife", "TOOL-KNIFE", "Tools", "7.60"},
                {"Measuring tape 5m", "TOOL-TAPE-5", "Tools", "11.20"},
                {"Pallet labels", "LABEL-PAL-50", "Packaging", "5.35"},
                {"Rubber floor mat", "SAFE-MAT-01", "Safety", "29.95"}
            };
            List<Product> plannedProducts = new ArrayList<>();
            for (String[] row : data) plannedProducts.add(product(row, counts));
            List<Warehouse> plannedWarehouses = Arrays.asList(
                warehouse("north", "North distribution", "Hamburg · Dock A", 12000, counts),
                warehouse("central", "Central fulfilment", "Dortmund · Hall 2", 8000, counts),
                warehouse("south", "South reserve", "Munich · Building C", 6000, counts));
            for (int i = 0; i < 18; i++) inventory(i, plannedProducts.get(i / 2), plannedWarehouses.get(i % 3), counts);
            if (state.isEmpty()) states.saveAndFlush(new DemoSeedState(accounts.id()));
            records.flush();
            return counts.result();
        } finally { SecurityContextHolder.setContext(previous); }
    }

    private Product product(String[] row, Counts counts) {
        String key = "local-v1/product/" + row[1];
        var tracked = records.findById(key);
        if (tracked.isPresent()) {
            var existing = products.findById(tracked.get().getRecordId());
            if (existing.isPresent()) counts.reusedProducts++; else counts.missingProducts++;
            return existing.orElse(null); // Manual edits/deletions are never reset or recreated.
        }
        var matches = products.findAllBySku(row[1]);
        if (matches.size() > 1) throw new IllegalStateException("Ambiguous product matches for demo SKU " + row[1] + ". Nothing was replaced.");
        Product product;
        if (matches.isEmpty()) {
            product = products.saveAndFlush(new Product(null, row[0], row[1], "Demo " + row[0].toLowerCase(), 0, new BigDecimal(row[3]), row[2]));
            counts.products++;
        } else {
            product = matches.get(0);
            if (!Objects.equals(product.getName(), row[0]) || !Objects.equals(product.getCategory(), row[2])
                    || !Objects.equals(product.getDescription(), "Demo " + row[0].toLowerCase())
                    || product.getPrice() == null || product.getPrice().compareTo(new BigDecimal(row[3])) != 0) {
                throw new IllegalStateException("Conflicting existing product for demo SKU " + row[1] + ". Nothing was replaced.");
            }
            counts.reusedProducts++;
        }
        records.save(new DemoSeedRecord(key, product.getId(), matches.isEmpty()));
        return product;
    }

    private Warehouse warehouse(String code, String name, String location, int capacity, Counts counts) {
        String key = "local-v1/warehouse/" + code;
        var tracked = records.findById(key);
        if (tracked.isPresent()) {
            var existing = warehouses.findById(tracked.get().getRecordId());
            if (existing.isPresent()) counts.reusedWarehouses++; else counts.missingWarehouses++;
            return existing.orElse(null);
        }
        var matches = warehouses.findAllByNameAndLocation(name, location);
        if (matches.size() > 1) throw new IllegalStateException("Ambiguous warehouse matches. Nothing was replaced.");
        Warehouse warehouse;
        if (matches.isEmpty()) { warehouse = warehouses.saveAndFlush(new Warehouse(null, name, location, capacity)); counts.warehouses++; }
        else {
            warehouse = matches.get(0);
            if (warehouse.getCapacity() != capacity) throw new IllegalStateException("Conflicting existing warehouse. Nothing was replaced.");
            counts.reusedWarehouses++;
        }
        records.save(new DemoSeedRecord(key, warehouse.getId(), matches.isEmpty()));
        return warehouse;
    }

    private void inventory(int index, Product product, Warehouse warehouse, Counts counts) {
        String key = "local-v1/inventory/" + index;
        var tracked = records.findById(key);
        if (tracked.isPresent()) {
            if (inventories.existsById(tracked.get().getRecordId())) counts.reusedInventory++; else counts.missingInventory++;
            return;
        }
        if (product == null || warehouse == null) throw new IllegalStateException("Incomplete demo identity map. No missing records were recreated.");
        var matches = inventories.findAllByProduct_IdAndWarehouse_Id(product.getId(), warehouse.getId());
        if (matches.size() > 1) throw new IllegalStateException("Ambiguous inventory matches. No stock was changed.");
        Inventory inventory;
        if (!matches.isEmpty()) {
            inventory = matches.get(0); counts.reusedInventory++;
            // Never fabricate opening balances or replay movements for preexisting inventory.
        } else {
            int initial = index % 5 == 0 ? 0 : 20 + index * 3;
            inventory = inventoryService.createInventory(new InventoryRequest(product.getId(), warehouse.getId(), initial));
            counts.inventory++;
            if (initial > 0) {
                MovementType type = MovementType.values()[index % 3];
                stock.move(inventory.getId(), type, type == MovementType.ADJUST ? initial + 2 : type == MovementType.RECEIVE ? 7 : 4,
                        type == MovementType.ADJUST ? "Cycle count confirmed" : type == MovementType.RECEIVE ? "Delivery received" : "Customer order dispatched");
                counts.movements += 2;
            }
        }
        records.save(new DemoSeedRecord(key, inventory.getId(), matches.isEmpty()));
    }

    private Accounts accounts(Path file) {
        try {
            if (!Files.exists(file)) {
                StringBuilder text = new StringBuilder("# Disposable local demo accounts\n\nDemo setup ID: " + UUID.randomUUID() + "\n\n| Role | Email | Password |\n| --- | --- | --- |\n");
                SecureRandom random = new SecureRandom();
                for (Role role : Role.values()) {
                    byte[] bytes = new byte[24]; random.nextBytes(bytes);
                    text.append("| ").append(role.name()).append(" | demo-").append(role.name().toLowerCase()).append("@lagermanager.test | ")
                            .append(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)).append(" |\n");
                }
                text.append("\nLocal disposable demo only. Keep this ignored file private; do not copy it into reports or screenshots.\n\n")
                        .append("Use the existing local lagermanager database. Keep its existing datasource environment and JWT signing key unchanged.\n")
                        .append("From the repository root: LAGERMANAGER_LOCAL_DEMO_POPULATE=true ./mvnw spring-boot:run -Dspring-boot.run.arguments=--spring.jpa.hibernate.ddl-auto=validate\n")
                        .append("Start frontend with cd frontend and npm run dev. Open localhost:5173 and sign in using one account above.\n")
                        .append("Repeat setup reuses these accounts and preserves manual changes. Normal startup never seeds. No database or signing secrets belong in this file.\n")
                        .append("Normal startup: ./mvnw spring-boot:run with no population opt-in or special profile. See docs/local-demo.md for the explicit password-only reset.\n");
                Files.createFile(file, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
                Files.writeString(file, text.toString(), StandardOpenOption.WRITE);
            }
            List<String> lines = Files.readAllLines(file);
            String id = lines.stream().filter(line -> line.startsWith("Demo setup ID: ")).findFirst().orElseThrow().substring(15);
            UUID.fromString(id);
            List<Account> accounts = new ArrayList<>();
            for (Role role : Role.values()) {
                String[] fields = lines.stream().filter(line -> line.startsWith("| " + role.name() + " | ")).findFirst().orElseThrow().split("\\|");
                String email = fields[2].trim(), password = fields[3].trim();
                if (!email.equals("demo-" + role.name().toLowerCase() + "@lagermanager.test") || (password.length() < 8 || password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 72)) throw new IllegalArgumentException();
                accounts.add(new Account(role, email, password));
            }
            return new Accounts(id, accounts);
        } catch (Exception failure) { throw new IllegalStateException("Local demo account file is missing, invalid or unwritable. Nothing was rotated or overwritten."); }
    }
}
