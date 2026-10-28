package com.lagermanager.inventory;

public class InventoryReferenceConflictException extends RuntimeException {

    public InventoryReferenceConflictException(String resource) {
        super("This " + resource + " is used by inventory and cannot be deleted.");
    }
}
