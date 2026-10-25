package com.lagermanager.security;

import com.lagermanager.user.User;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.JwtParser;
import io.jsonwebtoken.Jwts;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;

@Service
public class JwtService {

    private static final Duration TOKEN_LIFETIME = Duration.ofMinutes(60);

    private final SecretKey signingKey;
    private final JwtParser parser;

    public JwtService(@Value("${LAGERMANAGER_JWT_SECRET:}") String secret) {
        byte[] keyBytes;
        try {
            keyBytes = Base64.getDecoder().decode(secret == null ? "" : secret);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("LAGERMANAGER_JWT_SECRET must be valid Base64");
        }
        if (keyBytes.length < 32) {
            throw new IllegalArgumentException(
                    "LAGERMANAGER_JWT_SECRET must encode at least 32 random bytes");
        }
        signingKey = new SecretKeySpec(keyBytes, "HmacSHA256");
        parser = Jwts.parser()
                .verifyWith(signingKey)
                .sig().clear().add(Jwts.SIG.HS256).and()
                .build();
    }

    public String generateToken(User user) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(user.getEmail())
                .claim("role", user.getRole().name())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(TOKEN_LIFETIME)))
                .signWith(signingKey, Jwts.SIG.HS256)
                .compact();
    }

    public String extractSubject(String token) {
        return parseClaims(token).getSubject();
    }

    public boolean isTokenValid(String token) {
        try {
            parseClaims(token);
            return true;
        } catch (JwtException | IllegalArgumentException exception) {
            return false;
        }
    }

    private Claims parseClaims(String token) {
        Claims claims = parser.parseSignedClaims(token).getPayload();
        if (claims.getExpiration() == null) {
            throw new JwtException("Token must contain an expiration");
        }
        return claims;
    }
}
