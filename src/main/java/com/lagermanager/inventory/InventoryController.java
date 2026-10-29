package com.lagermanager.inventory;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PatchMapping;
import tools.jackson.databind.JsonNode;

import java.util.List;
import com.lagermanager.stock.*;

@RestController
@RequestMapping("/api/inventory")
public class InventoryController {

    private final InventoryService inventoryService;
    private final StockService stock;

    public InventoryController(InventoryService inventoryService, StockService stock) {
        this.inventoryService = inventoryService;
        this.stock = stock;
    }

    @PostMapping
    public Inventory createInventory(@RequestBody JsonNode body) {
        return inventoryService.createInventory(inventoryRequest(body));
    }

    @GetMapping
    public List<Inventory> getAllInventory() {
        return inventoryService.getAllInventory();
    }

    @GetMapping("/{id}")
    public Inventory getInventoryById(@PathVariable Long id) {
        return inventoryService.getInventoryById(id);
    }

    @PutMapping("/{id}")
    public Inventory updateInventory(@PathVariable Long id, @RequestBody JsonNode body) {
        return inventoryService.updateInventory(id, inventoryRequest(body));
    }

    @DeleteMapping("/{id}")
    public void deleteInventory(@PathVariable Long id) {
        inventoryService.deleteInventory(id);
    }

    @PatchMapping("/{id}/quantity")
    public Inventory updateQuantity(@PathVariable Long id, @RequestBody JsonNode body) {
        // Check the JSON type before binding so fractions and strings cannot be coerced to integers.
        JsonNode quantity = body.get("quantity");
        if (quantity == null || !quantity.isIntegralNumber() || !quantity.canConvertToInt()
                || quantity.intValue() < 0) {
            throw StockService.invalid("Enter a valid whole-number quantity.");
        }
        InventoryQuantityRequest request = new InventoryQuantityRequest(quantity.intValue());
        request.setReason(reason(body));
        StockService.validate(MovementType.ADJUST, request.getQuantity(), request.getReason());
        return inventoryService.updateQuantity(id, request);
    }
    @GetMapping("/{id}/movements")
    public List<StockMovement> history(@PathVariable Long id) { return stock.history(id); }

    @PostMapping("/{id}/movements")
    public Inventory movement(@PathVariable Long id, @RequestBody JsonNode body) {
        MovementType type;
        try { type = MovementType.valueOf(body.path("type").asString()); }
        catch (RuntimeException invalid) { throw StockService.invalid("Choose a valid stock operation."); }
        JsonNode quantity = body.get("quantity");
        if (quantity == null || !quantity.isIntegralNumber() || !quantity.canConvertToInt()) {
            throw StockService.invalid("Enter a valid whole-number quantity.");
        }
        return stock.move(id, type, quantity.intValue(), reason(body));
    }

    private String reason(JsonNode body) {
        JsonNode value = body.get("reason");
        if (value == null || value.isNull()) return null;
        if (!value.isString()) throw StockService.invalid("Enter a short reason.");
        return value.asString();
    }

    private InventoryRequest inventoryRequest(JsonNode body) {
        for (String name : new String[] {"productId", "warehouseId", "quantity"}) {
            JsonNode value = body.get(name);
            if (value == null || !value.isIntegralNumber() || !value.canConvertToLong() || value.longValue() < 0
                    || (!name.equals("quantity") && value.longValue() == 0)
                    || (name.equals("quantity") && !value.canConvertToInt())) {
                throw StockService.invalid("Choose valid records and enter a nonnegative whole-number quantity.");
            }
        }
        return new InventoryRequest(body.get("productId").longValue(), body.get("warehouseId").longValue(), body.get("quantity").intValue());
    }
}

