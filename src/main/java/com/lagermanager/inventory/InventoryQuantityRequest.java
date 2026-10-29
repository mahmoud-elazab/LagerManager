package com.lagermanager.inventory;

public class InventoryQuantityRequest {

    private Integer quantity;
    private String reason;

    public InventoryQuantityRequest() {
    }

    public InventoryQuantityRequest(Integer quantity) {
        this.quantity = quantity;
    }

    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }

    public Integer getQuantity() {
        return quantity;
    }

    public void setQuantity(Integer quantity) {
        this.quantity = quantity;
    }
}
