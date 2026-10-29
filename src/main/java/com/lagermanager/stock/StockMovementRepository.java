package com.lagermanager.stock;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface StockMovementRepository extends JpaRepository<StockMovement, Long> {
    List<StockMovement> findByInventory_IdOrderByIdDesc(Long inventoryId);
    boolean existsByInventory_Id(Long inventoryId);
}
