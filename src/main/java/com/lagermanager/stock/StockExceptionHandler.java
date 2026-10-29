package com.lagermanager.stock;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import java.util.Map;

@RestControllerAdvice
public class StockExceptionHandler {
    @ExceptionHandler(StockException.class)
    public ResponseEntity<Map<String, String>> handle(StockException exception) {
        return ResponseEntity.status(exception.getStatus())
                .body(Map.of("code", exception.getCode(), "message", exception.getMessage()));
    }
}
