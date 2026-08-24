package com.lagermanager.warehouse;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class WarehouseService {

    private final List<Warehouse> warehouses = new ArrayList<>();
    private final AtomicLong idCounter = new AtomicLong(0);

    public Warehouse createWarehouse(Warehouse warehouse) {
        warehouse.setId(idCounter.incrementAndGet());
        warehouses.add(warehouse);
        return warehouse;
    }

    public List<Warehouse> getAllWarehouses() {
        return warehouses;
    }

    public Warehouse getWarehouseById(Long id) {
        for (Warehouse warehouse : warehouses) {
            if (warehouse.getId().equals(id)) {
                return warehouse;
            }
        }
        return null;
    }

    public Warehouse updateWarehouse(Long id, Warehouse updatedWarehouse) {
        Warehouse warehouse = getWarehouseById(id);
        if (warehouse == null) {
            return null;
        }
        warehouse.setName(updatedWarehouse.getName());
        warehouse.setLocation(updatedWarehouse.getLocation());
        warehouse.setCapacity(updatedWarehouse.getCapacity());
        return warehouse;
    }

    public void deleteWarehouse(Long id) {
        warehouses.removeIf(warehouse -> warehouse.getId().equals(id));
    }
}
