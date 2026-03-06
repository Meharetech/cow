const jwt = require('jsonwebtoken');

class TokenService {
    // Generate Access Token
    generateAccessToken(userId, role, email) {
        return jwt.sign(
            {
                userId,
                role,
                email,
                type: 'access'
            },
            process.env.JWT_ACCESS_SECRET,
            { expiresIn: process.env.JWT_ACCESS_EXPIRY }
        );
    }

    // Generate Refresh Token
    generateRefreshToken(userId, role) {
        return jwt.sign(
            {
                userId,
                role,
                type: 'refresh'
            },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: process.env.JWT_REFRESH_EXPIRY }
        );
    }

    // Generate both tokens
    generateTokenPair(userId, role, email) {
        return {
            accessToken: this.generateAccessToken(userId, role, email),
            refreshToken: this.generateRefreshToken(userId, role)
        };
    }

    // Verify Access Token
    verifyAccessToken(token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
            if (decoded.type !== 'access') {
                throw new Error('Invalid token type');
            }
            return { valid: true, decoded };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    // Verify Refresh Token
    verifyRefreshToken(token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
            if (decoded.type !== 'refresh') {
                throw new Error('Invalid token type');
            }
            return { valid: true, decoded };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    // Decode token without verification (for debugging)
    decodeToken(token) {
        try {
            return jwt.decode(token);
        } catch (error) {
            return null;
        }
    }
}

module.exports = new TokenService();
