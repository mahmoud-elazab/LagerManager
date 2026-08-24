package com.lagermanager.inventory;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class InventoryService {

    private final List<Inventory> inventoryRecords = new ArrayList<>();
    private final AtomicLong idCounter = new AtomicLong(0);

    public Inventory createInventory(Inventory inventory) {
        inventory.setId(idCounter.incrementAndGet());
        inventoryRecords.add(inventory);
        return inventory;
    }

    public List<Inventory> getAllInventory() {
        return inventoryRecords;
    }

    public Inventory getInventoryById(Long id) {
        for (Inventory inventory : inventoryRecords) {
            if (inventory.getId().equals(id)) {
                return inventory;
            }
        }
        return null;
    }

    public Inventory updateInventory(Long id, Inventory updatedInventory) {
        Inventory inventory = getInventoryById(id);
        if (inventory == null) {
            return null;
        }
        inventory.setProductId(updatedInventory.getProductId());
        inventory.setWarehouseId(updatedInventory.getWarehouseId());
        inventory.setQuantity(updatedInventory.getQuantity());
        return inventory;
    }

    public void deleteInventory(Long id) {
        inventoryRecords.removeIf(inventory -> inventory.getId().equals(id));
    }
}
