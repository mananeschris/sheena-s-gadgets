const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function passwordMatches(inputPassword, storedPassword) {
  if (!storedPassword) return false;
  const rawPassword = String(inputPassword || "");
  const trimmedPassword = rawPassword.trim();
  if (await bcrypt.compare(rawPassword, storedPassword)) return true;
  if (trimmedPassword !== rawPassword) return bcrypt.compare(trimmedPassword, storedPassword);
  return false;
}

function cleanText(value, maxLength = 255) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeDateInput(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function customerAge(birthday) {
  const date = new Date(`${birthday}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const passed = today.getMonth() > date.getMonth() ||
    (today.getMonth() === date.getMonth() && today.getDate() >= date.getDate());
  if (!passed) age -= 1;
  return age;
}

function isValidPassword(password) {
  return /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/.test(String(password || ""));
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    birthday: normalizeDateInput(user.birthday),
    phone: user.phone || "",
    gender: user.gender || "",
    address: user.address || "",
    city: user.city || "",
    province: user.province || "",
    postal_code: user.postal_code || ""
  };
}

function getUserById(db, id) {
  return new Promise((resolve, reject) => {
    db.query(
      "SELECT id, name, email, role, birthday, phone, gender, address, city, province, postal_code FROM users WHERE id=? AND role='customer' LIMIT 1",
      [id],
      (err, rows) => err ? reject(err) : resolve(rows[0] || null)
    );
  });
}
// REGISTER
router.post("/register", async (req, res) => {
  const {
    name,
    email,
    password,
    birthday,
    phone,
    gender,
    address,
    city,
    province,
    postal_code
  } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email, and password are required" });
  }

  if (!birthday || !phone || !address || !city || !province || !postal_code) {
    return res.status(400).json({ message: "Complete customer profile information is required" });
  }

  const birthDate = new Date(birthday);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());

  if (!hasBirthdayPassed) age -= 1;

  if (Number.isNaN(birthDate.getTime()) || age < 13) {
    return res.status(400).json({ message: "Customer must be at least 13 years old" });
  }

  const isValidPassword = (password) => {
    const regex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;
    return regex.test(password);
  };

  if (!isValidPassword(password)) {
    return res.status(400).json({ message: "Weak password" });
  }

  const normalizedEmail = normalizeEmail(email);
  const checkSql = "SELECT * FROM users WHERE LOWER(TRIM(email)) = ?";

  req.db.query(checkSql, [normalizedEmail], async (err, result) => {
    if (err) return res.status(500).json({ message: err.message });

    if (result.length > 0) {
      return res.status(400).json({ message: "Email exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = `
      INSERT INTO users
      (name, email, password, role, birthday, phone, gender, address, city, province, postal_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    req.db.query(sql, [
      name,
      normalizedEmail,
      hashedPassword,
      "customer",
      birthday,
      phone,
      gender || null,
      address,
      city,
      province,
      postal_code
    ], (err2) => {
      if (err2) return res.status(500).json({ message: err2.message });

      res.json({ message: "User registered successfully" });
    });
  });
});

// LOGIN
router.post("/login", (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const sql = "SELECT * FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1";

  req.db.query(sql, [normalizedEmail], async (err, result) => {
    if (err) return res.status(500).json({ message: err.message });

    if (result.length === 0) {
      return res.status(400).json({ message: "User not found" });
    }

    const user = result[0];

    const isMatch = await passwordMatches(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
    }

    res.json({
      message: "Login successful",
      user: safeUser(user)
    });
  });
});

// CUSTOMER PROFILE
router.get("/profile/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Valid customer id is required" });
  }

  try {
    const user = await getUserById(req.db, id);
    if (!user) return res.status(404).json({ message: "Customer profile not found" });
    res.json({ user: safeUser(user) });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load customer profile" });
  }
});

router.put("/profile/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Valid customer id is required" });
  }

  const name = cleanText(req.body.name, 255);
  const email = normalizeEmail(req.body.email);
  const birthday = normalizeDateInput(req.body.birthday);
  const phone = cleanText(req.body.phone, 50);
  const gender = cleanText(req.body.gender, 40) || null;

  if (!name || !email || !birthday || !phone) {
    return res.status(400).json({ message: "Name, email, birthday, and phone are required" });
  }

  const age = customerAge(birthday);
  if (age === null || age < 13) {
    return res.status(400).json({ message: "Customer must be at least 13 years old" });
  }

  try {
    const duplicate = await new Promise((resolve, reject) => {
      req.db.query(
        "SELECT id FROM users WHERE LOWER(TRIM(email))=? AND id<>? LIMIT 1",
        [email, id],
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    });
    if (duplicate.length) return res.status(400).json({ message: "Email is already used by another account" });

    await new Promise((resolve, reject) => {
      req.db.query(
        "UPDATE users SET name=?, email=?, birthday=?, phone=?, gender=? WHERE id=? AND role='customer'",
        [name, email, birthday, phone, gender, id],
        (err, result) => err ? reject(err) : resolve(result)
      );
    });

    const user = await getUserById(req.db, id);
    if (!user) return res.status(404).json({ message: "Customer profile not found" });
    res.json({ message: "Profile updated successfully", user: safeUser(user) });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to update profile" });
  }
});

router.put("/profile/:id/password", async (req, res) => {
  const id = Number(req.params.id);
  const currentPassword = String(req.body.current_password || "");
  const newPassword = String(req.body.new_password || "");
  const confirmPassword = String(req.body.confirm_password || "");

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Valid customer id is required" });
  }

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ message: "Current password, new password, and confirmation are required" });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: "New password and confirmation do not match" });
  }

  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ message: "Password must be at least 8 characters with uppercase letter, number, and special character" });
  }

  try {
    const users = await new Promise((resolve, reject) => {
      req.db.query("SELECT id, password FROM users WHERE id=? AND role='customer' LIMIT 1", [id], (err, rows) => err ? reject(err) : resolve(rows));
    });
    const user = users[0];
    if (!user) return res.status(404).json({ message: "Customer profile not found" });

    const matches = await passwordMatches(currentPassword, user.password);
    if (!matches) return res.status(400).json({ message: "Current password is incorrect" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await new Promise((resolve, reject) => {
      req.db.query("UPDATE users SET password=? WHERE id=? AND role='customer'", [hashedPassword, id], (err, result) => err ? reject(err) : resolve(result));
    });

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to update password" });
  }
});

module.exports = router;
