package com.lagermanager.inventory;

import com.lagermanager.product.ProductRepository;
import com.lagermanager.warehouse.WarehouseRepository;
import com.lagermanager.stock.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.Objects;

@Service
public class InventoryService {
    private final InventoryRepository inventoryRepository;
    private final ProductRepository productRepository;
    private final WarehouseRepository warehouseRepository;
    private final StockService stock;
    private final StockMovementRepository movements;

    public InventoryService(InventoryRepository inventoryRepository, ProductRepository productRepository,
                            WarehouseRepository warehouseRepository, StockService stock, StockMovementRepository movements) {
        this.inventoryRepository = inventoryRepository;
        this.productRepository = productRepository;
        this.warehouseRepository = warehouseRepository;
        this.stock = stock;
        this.movements = movements;
    }

    @Transactional
    public Inventory createInventory(InventoryRequest request) {
        if (request.getQuantity() < 0 || request.getProductId() == null || request.getWarehouseId() == null) {
            throw StockService.invalid("Choose a product and warehouse and enter a valid quantity.");
        }
        StockService.actor();
        var product = productRepository.findById(request.getProductId())
                .orElseThrow(() -> new StockException(404, "PRODUCT_NOT_FOUND", "Product was not found."));
        var warehouse = warehouseRepository.findById(request.getWarehouseId())
                .orElseThrow(() -> new StockException(404, "WAREHOUSE_NOT_FOUND", "Warehouse was not found."));
        Inventory inventory = inventoryRepository.saveAndFlush(new Inventory(null, product, warehouse, 0));
        if (request.getQuantity() > 0) return stock.move(inventory.getId(), MovementType.RECEIVE, request.getQuantity(), "Initial stock");
        return inventory;
    }

    public List<Inventory> getAllInventory() { return inventoryRepository.findAll(); }
    public Inventory getInventoryById(Long id) { return inventoryRepository.findById(id).orElse(null); }

    @Transactional
    public Inventory updateInventory(Long id, InventoryRequest request) {
        Inventory inventory = inventoryRepository.findByIdForUpdate(id)
                .orElseThrow(() -> new StockException(404, "INVENTORY_NOT_FOUND", "Inventory was not found."));
        if (request.getQuantity() != inventory.getQuantity()) throw StockService.conflict("Use a stock movement to change quantity.");
        boolean reassociate = inventory.getProduct() == null || inventory.getWarehouse() == null
                || !Objects.equals(inventory.getProduct().getId(), request.getProductId())
                || !Objects.equals(inventory.getWarehouse().getId(), request.getWarehouseId());
        if (reassociate && (inventory.getQuantity() != 0 || movements.existsByInventory_Id(id))) {
            throw StockService.conflict("Inventory with stock or movement history cannot be reassigned.");
        }
        var product = productRepository.findById(request.getProductId())
                .orElseThrow(() -> new StockException(404, "PRODUCT_NOT_FOUND", "Product was not found."));
        var warehouse = warehouseRepository.findById(request.getWarehouseId())
                .orElseThrow(() -> new StockException(404, "WAREHOUSE_NOT_FOUND", "Warehouse was not found."));
        inventory.setProduct(product);
        inventory.setWarehouse(warehouse);
        return inventoryRepository.saveAndFlush(inventory);
    }

    @Transactional
    public void deleteInventory(Long id) {
        Inventory inventory = inventoryRepository.findByIdForUpdate(id)
                .orElseThrow(() -> new StockException(404, "INVENTORY_NOT_FOUND", "Inventory was not found."));
        if (inventory.getQuantity() != 0 || movements.existsByInventory_Id(id)) {
            throw StockService.conflict("Inventory with stock or movement history cannot be deleted.");
        }
        inventoryRepository.delete(inventory);
        inventoryRepository.flush();
    }

    public Inventory updateQuantity(Long id, InventoryQuantityRequest request) {
        return stock.move(id, MovementType.ADJUST, request.getQuantity(), request.getReason());
    }
}
