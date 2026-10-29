package com.lagermanager.inventory;

import org.springframework.data.jpa.repository.JpaRepository;

public interface InventoryRepository extends JpaRepository<Inventory, Long> {
    java.util.List<Inventory> findAllByProduct_IdAndWarehouse_Id(Long productId, Long warehouseId);


    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select i from Inventory i where i.id = :id")
    java.util.Optional<Inventory> findByIdForUpdate(@org.springframework.data.repository.query.Param("id") Long id);

    boolean existsByProduct_Id(Long id);

    boolean existsByWarehouse_Id(Long id);
}
