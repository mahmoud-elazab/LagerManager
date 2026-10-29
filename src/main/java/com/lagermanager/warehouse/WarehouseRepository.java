package com.lagermanager.warehouse;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import java.util.Optional;

public interface WarehouseRepository extends JpaRepository<Warehouse, Long> {
    java.util.List<Warehouse> findAllByNameAndLocation(String name, String location);


    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select warehouse from Warehouse warehouse where warehouse.id = :id")
    Optional<Warehouse> findByIdForDeletion(@Param("id") Long id);
}
