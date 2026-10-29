package com.lagermanager.stock;

import com.lagermanager.inventory.Inventory;
import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import java.time.Instant;

@Entity
public class StockMovement {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(optional = false) @JoinColumn(nullable = false)
    @JsonIgnore
    private Inventory inventory;
    @Enumerated(EnumType.STRING) @Column(nullable = false)
    private MovementType type;
    @Column(nullable = false) private long quantityChange;
    @Column(nullable = false) private int previousQuantity;
    @Column(nullable = false) private int resultingQuantity;
    @Column(nullable = false) private Instant timestamp;
    @Column(nullable = false) private String actor;
    @Column(nullable = false, length = 200) private String reason;

    protected StockMovement() { }

    public StockMovement(Inventory inventory, MovementType type, long quantityChange, int previousQuantity,
                         int resultingQuantity, String actor, String reason) {
        this.inventory = inventory;
        this.type = type;
        this.quantityChange = quantityChange;
        this.previousQuantity = previousQuantity;
        this.resultingQuantity = resultingQuantity;
        this.timestamp = Instant.now();
        this.actor = actor;
        this.reason = reason;
    }

    public Long getId() { return id; }
    public Long getInventoryId() { return inventory.getId(); }
    public MovementType getType() { return type; }
    public long getQuantityChange() { return quantityChange; }
    public int getPreviousQuantity() { return previousQuantity; }
    public int getResultingQuantity() { return resultingQuantity; }
    public Instant getTimestamp() { return timestamp; }
    public String getActor() { return actor; }
    public String getReason() { return reason; }
}
