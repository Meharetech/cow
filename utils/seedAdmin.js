const Admin = require('../models/Admin');
const logger = require('./logger');

const seedAdmin = async () => {
    try {
        // Check if any admin exists
        const adminCount = await Admin.countDocuments();

        if (adminCount === 0) {
            logger.info('No admin found in database. Seeding default admin...');

            const adminEmail = process.env.ADMIN_EMAIL || 'admin@cowrescue.com';
            const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
            const adminMobile = process.env.ADMIN_MOBILE || '9999999999';

            const newAdmin = new Admin({
                email: adminEmail,
                password: adminPassword,
                mobile: adminMobile,
                name: 'System Admin'
            });

            await newAdmin.save();
            logger.info(`✅ Default admin created successfully: ${adminEmail}`);
            console.log(`\n✅ Default admin created: ${adminEmail} / ${adminPassword}\n`);
        } else {
            logger.info('Admin(s) already exist in database. Skipping seeding.');
        }
    } catch (error) {
        logger.error('Error seeding admin:', error);
    }
};

module.exports = seedAdmin;
