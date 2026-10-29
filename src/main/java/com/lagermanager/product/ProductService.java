package com.lagermanager.product;

import org.springframework.stereotype.Service;
import com.lagermanager.inventory.InventoryRepository;
import com.lagermanager.inventory.InventoryReferenceConflictException;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class ProductService {

    private final ProductRepository productRepository;
    private final InventoryRepository inventoryRepository;

    public ProductService(ProductRepository productRepository, InventoryRepository inventoryRepository) {
        this.productRepository = productRepository;
        this.inventoryRepository = inventoryRepository;
    }

    public Product createProduct(Product product) {
        return productRepository.saveAndFlush(product);
    }

    public List<Product> getAllProducts() {
        return productRepository.findAll();
    }

    public Product getProductById(Long id) {
        return productRepository.findById(id).orElse(null);
    }

    public Product updateProduct(Long id, Product updatedProduct) {
        Product product = getProductById(id);
        if (product == null) {
            return null;
        }
        product.setName(updatedProduct.getName());
        product.setSku(updatedProduct.getSku());
        product.setDescription(updatedProduct.getDescription());
        product.setPrice(updatedProduct.getPrice());
        product.setCategory(updatedProduct.getCategory());
        return productRepository.saveAndFlush(product);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED, propagation = Propagation.REQUIRES_NEW)
    public void deleteProduct(Long id) {
        // Parent lock also serializes InnoDB foreign-key checks by concurrent inventory writers.
        Product product = productRepository.findByIdForDeletion(id).orElse(null);
        if (product == null) {
            return;
        }
        if (inventoryRepository.existsByProduct_Id(id)) {
            throw new InventoryReferenceConflictException("product");
        }
        productRepository.delete(product);
        productRepository.flush();
    }
}
