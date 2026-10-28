package com.lagermanager.auth.dto;

import com.lagermanager.user.Role;

public class CurrentUserResponse {

    private final String email;
    private final Role role;

    public CurrentUserResponse(String email, Role role) {
        this.email = email;
        this.role = role;
    }

    public String getEmail() {
        return email;
    }

    public Role getRole() {
        return role;
    }
}
