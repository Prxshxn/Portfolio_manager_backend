/**
 * Password validation utility for strong password enforcement
 * Can be used on both backend (Node.js) and frontend (React) environments
 */

class PasswordValidator {
  constructor(options = {}) {
    this.config = {
      minLength: options.minLength || 8,
      maxLength: options.maxLength || 128,
      requireUppercase: options.requireUppercase !== false, // default true
      requireLowercase: options.requireLowercase !== false, // default true
      requireNumbers: options.requireNumbers !== false, // default true
      requireSpecialChars: options.requireSpecialChars !== false, // default true
      allowSpaces: options.allowSpaces || false,
      specialChars: options.specialChars || '!@#$%^&*()_+-=[]{}|;:,.<>?',
      ...options
    };
  }

  /**
   * Validates a password against all configured rules
   * @param {string} password - The password to validate
   * @returns {Object} - Validation result with isValid boolean and errors array
   */
  validate(password) {
    const errors = [];
    
    if (!password || typeof password !== 'string') {
      return {
        isValid: false,
        errors: ['Password is required'],
        score: 0
      };
    }

    // Length validation
    if (password.length < this.config.minLength) {
      errors.push(`Password must be at least ${this.config.minLength} characters long`);
    }
    
    if (password.length > this.config.maxLength) {
      errors.push(`Password must be no more than ${this.config.maxLength} characters long`);
    }

    // Character type validations
    if (this.config.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (this.config.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (this.config.requireNumbers && !/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (this.config.requireSpecialChars) {
      const specialCharsRegex = new RegExp(`[${this.escapeRegex(this.config.specialChars)}]`);
      if (!specialCharsRegex.test(password)) {
        errors.push(`Password must contain at least one special character (${this.config.specialChars})`);
      }
    }

    // Space validation
    if (!this.config.allowSpaces && /\s/.test(password)) {
      errors.push('Password cannot contain spaces');
    }

    // Common password patterns (weak password detection)
    const weakPatterns = this.checkWeakPatterns(password);
    if (weakPatterns.length > 0) {
      errors.push(...weakPatterns);
    }

    const score = this.calculateScore(password);

    return {
      isValid: errors.length === 0,
      errors,
      score,
      strength: this.getStrengthLabel(score)
    };
  }

  /**
   * Calculates password strength score (0-100)
   * @param {string} password 
   * @returns {number} Score from 0 to 100
   */
  calculateScore(password) {
    let score = 0;
    
    // Base score for length
    score += Math.min(password.length * 4, 40);
    
    // Bonus for character variety
    if (/[a-z]/.test(password)) score += 5;
    if (/[A-Z]/.test(password)) score += 5;
    if (/[0-9]/.test(password)) score += 5;
    if (new RegExp(`[${this.escapeRegex(this.config.specialChars)}]`).test(password)) score += 10;
    
    // Bonus for mixed case
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 5;
    
    // Bonus for numbers and letters
    if (/[a-zA-Z]/.test(password) && /[0-9]/.test(password)) score += 5;
    
    // Bonus for numbers and special chars
    if (/[0-9]/.test(password) && new RegExp(`[${this.escapeRegex(this.config.specialChars)}]`).test(password)) score += 5;
    
    // Bonus for length beyond minimum
    if (password.length > this.config.minLength) {
      score += Math.min((password.length - this.config.minLength) * 2, 20);
    }
    
    // Penalty for common patterns
    const penalties = this.calculatePenalties(password);
    score = Math.max(0, score - penalties);
    
    return Math.min(score, 100);
  }

  /**
   * Calculate penalties for weak patterns
   * @param {string} password 
   * @returns {number} Penalty points
   */
  calculatePenalties(password) {
    let penalties = 0;
    
    // Repeated characters
    const repeatedChars = password.match(/(.)\1{2,}/g);
    if (repeatedChars) {
      penalties += repeatedChars.length * 10;
    }
    
    // Sequential characters (abc, 123, etc.)
    if (this.hasSequentialChars(password)) {
      penalties += 15;
    }
    
    // Common patterns
    const commonPatterns = [
      /123/g, /abc/g, /qwe/g, /asd/g, /zxc/g,
      /password/gi, /admin/gi, /user/gi, /login/gi
    ];
    
    commonPatterns.forEach(pattern => {
      if (pattern.test(password)) {
        penalties += 20;
      }
    });
    
    return penalties;
  }

  /**
   * Check for weak password patterns
   * @param {string} password 
   * @returns {Array} Array of warning messages
   */
  checkWeakPatterns(password) {
    const warnings = [];
    
    // All same character
    if (/^(.)\1+$/.test(password)) {
      warnings.push('Password cannot be all the same character');
    }
    
    // Common weak passwords
    const commonPasswords = [
      'password', 'password123', '12345678', 'qwerty123', 'admin123',
      'letmein', 'welcome', 'monkey', '123456789', 'password1'
    ];
    
    if (commonPasswords.includes(password.toLowerCase())) {
      warnings.push('Password is too common and easily guessed');
    }
    
    // Keyboard patterns
    const keyboardPatterns = [
      'qwerty', 'asdf', 'zxcv', '1234', 'abcd'
    ];
    
    const lowerPassword = password.toLowerCase();
    keyboardPatterns.forEach(pattern => {
      if (lowerPassword.includes(pattern)) {
        warnings.push('Password contains common keyboard patterns');
      }
    });
    
    return warnings;
  }

  /**
   * Check for sequential characters
   * @param {string} password 
   * @returns {boolean}
   */
  hasSequentialChars(password) {
    const lower = password.toLowerCase();
    
    // Check for 3+ sequential letters or numbers
    for (let i = 0; i < lower.length - 2; i++) {
      const char1 = lower.charCodeAt(i);
      const char2 = lower.charCodeAt(i + 1);
      const char3 = lower.charCodeAt(i + 2);
      
      if ((char2 === char1 + 1 && char3 === char2 + 1) ||
          (char2 === char1 - 1 && char3 === char2 - 1)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get strength label based on score
   * @param {number} score 
   * @returns {string}
   */
  getStrengthLabel(score) {
    if (score < 30) return 'Very Weak';
    if (score < 50) return 'Weak';
    if (score < 70) return 'Fair';
    if (score < 85) return 'Good';
    return 'Strong';
  }

  /**
   * Get strength color for UI
   * @param {number} score 
   * @returns {string}
   */
  getStrengthColor(score) {
    if (score < 30) return '#dc3545'; // red
    if (score < 50) return '#fd7e14'; // orange
    if (score < 70) return '#ffc107'; // yellow
    if (score < 85) return '#20c997'; // teal
    return '#28a745'; // green
  }

  /**
   * Escape regex special characters
   * @param {string} string 
   * @returns {string}
   */
  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Generate password requirements text for UI
   * @returns {Array} Array of requirement strings
   */
  getRequirements() {
    const requirements = [];
    
    requirements.push(`At least ${this.config.minLength} characters long`);
    
    if (this.config.requireUppercase) {
      requirements.push('One uppercase letter');
    }
    
    if (this.config.requireLowercase) {
      requirements.push('One lowercase letter');
    }
    
    if (this.config.requireNumbers) {
      requirements.push('One number');
    }
    
    if (this.config.requireSpecialChars) {
      requirements.push(`One special character (${this.config.specialChars})`);
    }
    
    if (!this.config.allowSpaces) {
      requirements.push('No spaces allowed');
    }
    
    return requirements;
  }
}

// Default validator instance with strong security requirements
const defaultValidator = new PasswordValidator({
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  allowSpaces: false
});

// Export for both CommonJS and ES modules
if (typeof module !== 'undefined' && module.exports) {
  // Node.js environment
  module.exports = {
    PasswordValidator,
    validatePassword: (password) => defaultValidator.validate(password),
    passwordValidator: defaultValidator
  };
} else {
  // Browser environment (will be copied to frontend)
  window.PasswordValidator = PasswordValidator;
  window.validatePassword = (password) => defaultValidator.validate(password);
}