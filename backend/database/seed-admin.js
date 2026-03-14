/**
 * Admin Seed Script
 * Run this script to create the initial admin user
 * Usage: node database/seed-admin.js
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const ADMIN_EMAIL = 'admin@college.edu';
const ADMIN_PASSWORD = 'Admin@123456';
const ADMIN_NAME = 'System Administrator';

async function seedAdmin() {
  try {
    console.log('Checking if admin user already exists...');
    
    // Check if admin exists
    const { data: existingAdmin } = await supabase
      .from('users')
      .select('id')
      .eq('email', ADMIN_EMAIL)
      .single();

    if (existingAdmin) {
      console.log('Admin user already exists. Skipping...');
      return;
    }

    console.log('Creating admin user...');

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, salt);

    // Create admin user
    const { data: newAdmin, error } = await supabase
      .from('users')
      .insert({
        email: ADMIN_EMAIL,
        password_hash: passwordHash,
        full_name: ADMIN_NAME,
        role: 'admin',
        is_active: true
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    console.log('========================================');
    console.log('Admin user created successfully!');
    console.log('========================================');
    console.log(`Email: ${ADMIN_EMAIL}`);
    console.log(`Password: ${ADMIN_PASSWORD}`);
    console.log('========================================');
    console.log('IMPORTANT: Change this password after first login!');
    console.log('========================================');

  } catch (error) {
    console.error('Error seeding admin:', error.message);
    process.exit(1);
  }
}

seedAdmin();
