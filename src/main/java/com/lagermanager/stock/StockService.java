package com.lagermanager.stock;

import com.lagermanager.inventory.Inventory;
import com.lagermanager.inventory.InventoryRepository;
import jakarta.persistence.EntityManager;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service
public class StockService {
    private final InventoryRepository inventories;
    private final StockMovementRepository movements;
    private final EntityManager entityManager;

    public StockService(InventoryRepository inventories, StockMovementRepository movements, EntityManager entityManager) {
        this.inventories = inventories;
        this.movements = movements;
        this.entityManager = entityManager;
    }

    public static StockException invalid(String message) { return new StockException(400, "INVALID_STOCK_REQUEST", message); }
    public static StockException conflict(String message) { return new StockException(409, "STOCK_HISTORY_CONFLICT", message); }
    public static String actor() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated() || authentication instanceof AnonymousAuthenticationToken) {
            throw new StockException(401, "AUTHENTICATION_REQUIRED", "Please sign in again.");
        }
        if (authentication.getName() == null || authentication.getName().isBlank()) throw new StockException(401, "AUTHENTICATION_REQUIRED", "Please sign in again.");
        return authentication.getName();
    }

    @Transactional
    public Inventory move(Long id, MovementType type, Integer quantity, String reason) {
        String actor = actor();
        String safeReason = validate(type, quantity, reason);
        Inventory inventory = inventories.findByIdForUpdate(id)
                .orElseThrow(() -> new StockException(404, "INVENTORY_NOT_FOUND", "Inventory was not found."));
        if (inventory.getProduct() == null || inventory.getWarehouse() == null) throw conflict("Choose a product and warehouse before changing stock.");
        int previous = inventory.getQuantity();
        if (previous < 0) throw conflict("This inventory needs an opening-stock review before it can be changed.");
        long resulting = switch (type) {
            case RECEIVE -> (long) previous + quantity;
            case ISSUE -> (long) previous - quantity;
            case ADJUST -> quantity;
        };
        if (resulting < 0) throw new StockException(409, "INSUFFICIENT_STOCK", "There is not enough stock to issue that quantity.");
        if (resulting > Integer.MAX_VALUE) throw invalid("The resulting quantity is too large.");
        if (resulting == previous) return inventory;
        inventory.setQuantity((int) resulting);
        inventories.saveAndFlush(inventory);
        movements.saveAndFlush(new StockMovement(inventory, type, resulting - previous, previous,
                (int) resulting, actor, safeReason));
        if (inventory.getProduct() != null) entityManager.refresh(inventory.getProduct());
        return inventory;
    }

    public static String validate(MovementType type, Integer quantity, String reason) {
        if (type == null || quantity == null || quantity < 0 || (type != MovementType.ADJUST && quantity == 0)) {
            throw invalid("Enter a valid quantity for this operation.");
        }
        String safe = reason == null ? "" : reason.trim();
        if (safe.length() > 200 || (type == MovementType.ADJUST && safe.replaceAll("\\s", "").length() < 3)) {
            throw invalid("Enter a short, meaningful reason for the adjustment.");
        }
        return safe.isEmpty() ? type == MovementType.RECEIVE ? "Stock received" : "Stock issued" : safe;
    }

    @Transactional(readOnly = true)
    public List<StockMovement> history(Long id) {
        if (!inventories.existsById(id)) throw new StockException(404, "INVENTORY_NOT_FOUND", "Inventory was not found.");
        return movements.findByInventory_IdOrderByIdDesc(id);
    }
}
