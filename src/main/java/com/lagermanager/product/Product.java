package com.lagermanager.product;

import java.math.BigDecimal;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.hibernate.annotations.Formula;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;

@Entity
public class Product {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String name;
    private String sku;
    private String description;
    // Legacy column retained for a future explicit migration; never used as stock.
    private int quantity;

    @Formula("(select coalesce(sum(i.quantity), 0) from inventory i where i.product_id = id)")
    private long totalStock;
    private BigDecimal price;
    private String category;

    public Product() {
    }

    public Product(Long id, String name, String sku, String description, int quantity, BigDecimal price, String category) {
        this.id = id;
        this.name = name;
        this.sku = sku;
        this.description = description;
        this.quantity = quantity;
        this.price = price;
        this.category = category;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getSku() {
        return sku;
    }

    public void setSku(String sku) {
        this.sku = sku;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    @JsonIgnore
    public int getQuantity() {
        return quantity;
    }

    @JsonIgnore
    public void setQuantity(int quantity) {
        this.quantity = quantity;
    }

    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    public long getTotalStock() { return totalStock; }

    public BigDecimal getPrice() {
        return price;
    }

    public void setPrice(BigDecimal price) {
        this.price = price;
    }

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
        this.category = category;
    }
}
