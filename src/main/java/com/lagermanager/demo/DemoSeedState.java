package com.lagermanager.demo;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

@Entity
public class DemoSeedState {
    @Id private String id;
    private String accountFileId;
    protected DemoSeedState() { }
    public DemoSeedState(String accountFileId) { this.id = "local-demo-v1"; this.accountFileId = accountFileId; }
    public String getAccountFileId() { return accountFileId; }
}
