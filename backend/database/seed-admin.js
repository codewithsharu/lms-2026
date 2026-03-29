/**
 * Admin Seed Script
 * Run this script to create the initial admin user
 * Usage: node database/seed-admin.js
 */

require('dotenv').config();
const supabase = require('../config/supabase');
const { createAuthUser } = require('../services/supabaseAuthService');

const ADMIN_EMAIL = 'admin@college.edu';
const ADMIN_PASSWORD = 'Admin@123456';
const ADMIN_NAME = 'System Administrator';
const LEGACY_PASSWORD_PLACEHOLDER = '__SUPABASE_AUTH__';

async function seedAdmin() {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY must be set in .env to seed admin auth account.');
    }

    console.log('Checking if admin user already exists...');
    
    // Check if admin exists
    const { data: existingAdmin } = await supabase
      .from('users')
      .select('id, auth_user_id')
      .eq('email', ADMIN_EMAIL)
      .maybeSingle();

    let authProvisionResult = null;

    if (!existingAdmin?.auth_user_id) {
      console.log('Ensuring admin auth account exists...');
      authProvisionResult = await createAuthUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        role: 'admin',
        fullName: ADMIN_NAME,
        isActive: true
      });
    }

    if (existingAdmin) {
      if (authProvisionResult?.user?.id && !existingAdmin.auth_user_id) {
        await supabase
          .from('users')
          .update({ auth_user_id: authProvisionResult.user.id })
          .eq('id', existingAdmin.id);
      }

      console.log('Admin user already exists. Skipping...');
      return;
    }

    console.log('Creating admin user...');

    if (!authProvisionResult?.user?.id) {
      throw new Error('Failed to provision admin auth account.');
    }

    // Create admin user
    const { data: newAdmin, error } = await supabase
      .from('users')
      .insert({
        email: ADMIN_EMAIL,
        password_hash: LEGACY_PASSWORD_PLACEHOLDER,
        auth_user_id: authProvisionResult.user.id,
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
