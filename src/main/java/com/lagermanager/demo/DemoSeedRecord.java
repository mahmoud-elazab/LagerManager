package com.lagermanager.demo;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;

/** Persistent identity map; deliberately retained if a manually deleted business record disappears. */
@Entity
public class DemoSeedRecord {
    @Id private String id;
    @Column(nullable = false) private Long recordId;
    @Column(nullable = false) private boolean createdBySeed;
    protected DemoSeedRecord() { }
    public DemoSeedRecord(String id, Long recordId, boolean createdBySeed) {
        this.id = id; this.recordId = recordId; this.createdBySeed = createdBySeed;
    }
    public String getId() { return id; }
    public Long getRecordId() { return recordId; }
    public boolean isCreatedBySeed() { return createdBySeed; }
}
