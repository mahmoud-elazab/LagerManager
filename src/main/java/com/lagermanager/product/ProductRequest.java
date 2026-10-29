package com.lagermanager.product;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.math.BigDecimal;

/** Stock and identity are not writable through product metadata requests. */
@JsonIgnoreProperties({"quantity", "totalStock", "id"})
public class ProductRequest {
    private String name;
    private String sku;
    private String description;
    private String category;
    private BigDecimal price;
    public ProductRequest() { }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getSku() { return sku; }
    public void setSku(String sku) { this.sku = sku; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public BigDecimal getPrice() { return price; }
    public void setPrice(BigDecimal price) { this.price = price; }
    public Product toProduct() { return new Product(null, name, sku, description, 0, price, category); }
}
