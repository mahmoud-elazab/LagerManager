package com.lagermanager.lowstock;

import org.springframework.scheduling.annotation.Scheduled;

import java.time.Duration;

public class LowStockJob {
    private final LowStockCheck check;
    private final long threshold;

    public LowStockJob(LowStockCheck check, long threshold, String interval) {
        if (threshold < 0) throw new IllegalArgumentException("Low-stock threshold must be nonnegative");
        if (Duration.parse(interval).toMillis() < 1) {
            throw new IllegalArgumentException("Low-stock interval must be at least one millisecond");
        }
        this.check = check;
        this.threshold = threshold;
    }

    @Scheduled(fixedDelayString = "${lagermanager.low-stock.interval:PT2H}",
            initialDelayString = "${lagermanager.low-stock.interval:PT2H}")
    public void run() { check.check(threshold); }
}
