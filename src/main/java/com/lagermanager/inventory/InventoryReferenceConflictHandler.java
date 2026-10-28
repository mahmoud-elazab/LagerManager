package com.lagermanager.inventory;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class InventoryReferenceConflictHandler {

    @ExceptionHandler(InventoryReferenceConflictException.class)
    public ResponseEntity<Map<String, String>> handleConflict(InventoryReferenceConflictException exception) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                "code", "INVENTORY_REFERENCE_CONFLICT", "message", exception.getMessage()));
    }
}
