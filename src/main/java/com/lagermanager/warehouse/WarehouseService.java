package com.lagermanager.warehouse;

import org.springframework.stereotype.Service;
import com.lagermanager.inventory.InventoryRepository;
import com.lagermanager.inventory.InventoryReferenceConflictException;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class WarehouseService {

    private final WarehouseRepository warehouseRepository;
    private final InventoryRepository inventoryRepository;

    public WarehouseService(WarehouseRepository warehouseRepository, InventoryRepository inventoryRepository) {
        this.warehouseRepository = warehouseRepository;
        this.inventoryRepository = inventoryRepository;
    }

    public Warehouse createWarehouse(Warehouse warehouse) {
        return warehouseRepository.save(warehouse);
    }

    public List<Warehouse> getAllWarehouses() {
        return warehouseRepository.findAll();
    }

    public Warehouse getWarehouseById(Long id) {
        return warehouseRepository.findById(id).orElse(null);
    }

    public Warehouse updateWarehouse(Long id, Warehouse updatedWarehouse) {
        Warehouse warehouse = getWarehouseById(id);
        if (warehouse == null) {
            return null;
        }
        warehouse.setName(updatedWarehouse.getName());
        warehouse.setLocation(updatedWarehouse.getLocation());
        warehouse.setCapacity(updatedWarehouse.getCapacity());
        return warehouseRepository.save(warehouse);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED, propagation = Propagation.REQUIRES_NEW)
    public void deleteWarehouse(Long id) {
        Warehouse warehouse = warehouseRepository.findByIdForDeletion(id).orElse(null);
        if (warehouse == null) {
            return;
        }
        if (inventoryRepository.existsByWarehouse_Id(id)) {
            throw new InventoryReferenceConflictException("warehouse");
        }
        warehouseRepository.delete(warehouse);
        warehouseRepository.flush();
    }
}
