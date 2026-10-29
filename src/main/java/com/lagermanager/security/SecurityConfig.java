package com.lagermanager.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.http.HttpMethod;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.DispatcherType;

@Configuration
public class SecurityConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public DaoAuthenticationProvider authenticationProvider(CustomUserDetailsService userDetailsService,
                                                           PasswordEncoder passwordEncoder) {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider(userDetailsService);
        provider.setPasswordEncoder(passwordEncoder);
        return provider;
    }

    @Bean
    public AuthenticationManager authenticationManager(DaoAuthenticationProvider authenticationProvider) {
        return new ProviderManager(authenticationProvider);
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http, JwtService jwtService,
                                                   CustomUserDetailsService userDetailsService) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(exceptions -> exceptions.authenticationEntryPoint(
                        (request, response, exception) -> response.setStatus(HttpServletResponse.SC_UNAUTHORIZED))
                        .accessDeniedHandler((request, response, exception) ->
                                response.setStatus(HttpServletResponse.SC_FORBIDDEN)))
                .authorizeHttpRequests(authorize -> authorize
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/login").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/auth/me")
                        .hasAnyRole("ADMIN", "MANAGER", "EMPLOYEE")
                        .requestMatchers(HttpMethod.GET, "/api/inventory/{id}/movements")
                        .hasAnyRole("ADMIN", "MANAGER", "EMPLOYEE")
                        .requestMatchers(HttpMethod.POST, "/api/inventory/{id}/movements")
                        .hasAnyRole("ADMIN", "MANAGER", "EMPLOYEE")
                        .requestMatchers(HttpMethod.PATCH, "/api/inventory/{id}/quantity")
                        .hasAnyRole("ADMIN", "MANAGER", "EMPLOYEE")
                        .requestMatchers(HttpMethod.GET, "/api/products", "/api/products/{id}",
                                "/api/warehouses", "/api/warehouses/{id}",
                                "/api/inventory", "/api/inventory/{id}")
                        .hasAnyRole("ADMIN", "MANAGER", "EMPLOYEE")
                        .requestMatchers(HttpMethod.POST, "/api/products", "/api/warehouses", "/api/inventory")
                        .hasAnyRole("ADMIN", "MANAGER")
                        .requestMatchers(HttpMethod.PUT, "/api/products/{id}", "/api/warehouses/{id}",
                                "/api/inventory/{id}")
                        .hasAnyRole("ADMIN", "MANAGER")
                        .requestMatchers(HttpMethod.DELETE, "/api/products/{id}", "/api/warehouses/{id}",
                                "/api/inventory/{id}").hasRole("ADMIN")
                        .anyRequest().authenticated())
                // Construct only here so Boot cannot also register it as a servlet filter.
                .addFilterBefore(new JwtAuthenticationFilter(jwtService, userDetailsService),
                        UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }
}
