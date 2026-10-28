package com.lagermanager.inventory;

import org.springframework.data.jpa.repository.JpaRepository;

public interface InventoryRepository extends JpaRepository<Inventory, Long> {

    boolean existsByProduct_Id(Long id);

    boolean existsByWarehouse_Id(Long id);
}
