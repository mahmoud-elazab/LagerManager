package com.lagermanager.lowstock;

import com.lagermanager.product.ProductService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class LowStockCheck {
    private static final Logger log = LoggerFactory.getLogger(LowStockCheck.class);
    private final ProductService products;

    public LowStockCheck(ProductService products) { this.products = products; }

    public record ProductStock(Long id, String sku, String name, long totalStock) { }

    @Transactional(readOnly = true)
    public List<ProductStock> check(long threshold) {
        if (threshold < 0) throw new IllegalArgumentException("Low-stock threshold must be nonnegative");
        // Reuse the inventory-derived total; Product.quantity is a legacy column, not stock.
        List<ProductStock> matches = products.getAllProducts().stream()
                .filter(product -> product.getTotalStock() <= threshold)
                .map(product -> new ProductStock(product.getId(), product.getSku(), product.getName(), product.getTotalStock()))
                .toList();
        log.info("Low-stock check: threshold={}, matched={}, products={}", threshold, matches.size(), matches);
        return matches;
    }
}
