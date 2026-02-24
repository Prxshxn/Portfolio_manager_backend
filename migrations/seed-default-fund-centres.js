const db = require('../config/db');

// Default fund centres data from the table
const defaultFundCentres = [
  {
    fund_centre_code: 'FC-NY',
    name: 'New York Fund Centre',
    city: 'New York',
    country: 'United States',
    iana_timezone: 'America/New_York',
    gmt_timezone: 'GMT-5',
    dst_observed: 'Y',
    currency: 'USD'
  },
  {
    fund_centre_code: 'FC-CHI',
    name: 'Chicago Fund Centre',
    city: 'Chicago',
    country: 'United States',
    iana_timezone: 'America/Chicago',
    gmt_timezone: 'GMT-6',
    dst_observed: 'Y',
    currency: 'USD'
  },
  {
    fund_centre_code: 'FC-LON',
    name: 'London Fund Centre',
    city: 'London',
    country: 'United Kingdom',
    iana_timezone: 'Europe/London',
    gmt_timezone: 'GMT+0',
    dst_observed: 'Y',
    currency: 'GBP'
  },
  {
    fund_centre_code: 'FC-FRA',
    name: 'Frankfurt Fund Centre',
    city: 'Frankfurt',
    country: 'Germany',
    iana_timezone: 'Europe/Berlin',
    gmt_timezone: 'GMT+1',
    dst_observed: 'Y',
    currency: 'EUR'
  },
  {
    fund_centre_code: 'FC-PAR',
    name: 'Paris Fund Centre',
    city: 'Paris',
    country: 'France',
    iana_timezone: 'Europe/Paris',
    gmt_timezone: 'GMT+1',
    dst_observed: 'Y',
    currency: 'EUR'
  },
  {
    fund_centre_code: 'FC-ZUR',
    name: 'Zurich Fund Centre',
    city: 'Zurich',
    country: 'Switzerland',
    iana_timezone: 'Europe/Zurich',
    gmt_timezone: 'GMT+1',
    dst_observed: 'Y',
    currency: 'CHF'
  },
  {
    fund_centre_code: 'FC-MAD',
    name: 'Madrid Fund Centre',
    city: 'Madrid',
    country: 'Spain',
    iana_timezone: 'Europe/Madrid',
    gmt_timezone: 'GMT+1',
    dst_observed: 'Y',
    currency: 'EUR'
  },
  {
    fund_centre_code: 'FC-DXB',
    name: 'Dubai Fund Centre',
    city: 'Dubai',
    country: 'UAE',
    iana_timezone: 'Asia/Dubai',
    gmt_timezone: 'GMT+4',
    dst_observed: 'N',
    currency: 'AED'
  },
  {
    fund_centre_code: 'FC-MUM',
    name: 'Mumbai Fund Centre',
    city: 'Mumbai',
    country: 'India',
    iana_timezone: 'Asia/Kolkata',
    gmt_timezone: 'GMT+5:30',
    dst_observed: 'N',
    currency: 'INR'
  },
  {
    fund_centre_code: 'FC-CMB',
    name: 'Colombo Fund Centre',
    city: 'Colombo',
    country: 'Sri Lanka',
    iana_timezone: 'Asia/Colombo',
    gmt_timezone: 'GMT+5:30',
    dst_observed: 'N',
    currency: 'LKR'
  },
  {
    fund_centre_code: 'FC-SIN',
    name: 'Singapore Fund Centre',
    city: 'Singapore',
    country: 'Singapore',
    iana_timezone: 'Asia/Singapore',
    gmt_timezone: 'GMT+8',
    dst_observed: 'N',
    currency: 'SGD'
  },
  {
    fund_centre_code: 'FC-HKG',
    name: 'Hong Kong Fund Centre',
    city: 'Hong Kong',
    country: 'Hong Kong',
    iana_timezone: 'Asia/Hong_Kong',
    gmt_timezone: 'GMT+8',
    dst_observed: 'N',
    currency: 'HKD'
  },
  {
    fund_centre_code: 'FC-BKK',
    name: 'Bangkok Fund Centre',
    city: 'Bangkok',
    country: 'Thailand',
    iana_timezone: 'Asia/Bangkok',
    gmt_timezone: 'GMT+7',
    dst_observed: 'N',
    currency: 'THB'
  },
  {
    fund_centre_code: 'FC-TYO',
    name: 'Tokyo Fund Centre',
    city: 'Tokyo',
    country: 'Japan',
    iana_timezone: 'Asia/Tokyo',
    gmt_timezone: 'GMT+9',
    dst_observed: 'N',
    currency: 'JPY'
  },
  {
    fund_centre_code: 'FC-SEO',
    name: 'Seoul Fund Centre',
    city: 'Seoul',
    country: 'South Korea',
    iana_timezone: 'Asia/Seoul',
    gmt_timezone: 'GMT+9',
    dst_observed: 'N',
    currency: 'KRW'
  },
  {
    fund_centre_code: 'FC-SYD',
    name: 'Sydney Fund Centre',
    city: 'Sydney',
    country: 'Australia',
    iana_timezone: 'Australia/Sydney',
    gmt_timezone: 'GMT+10',
    dst_observed: 'Y',
    currency: 'AUD'
  },
  {
    fund_centre_code: 'FC-MEL',
    name: 'Melbourne Fund Centre',
    city: 'Melbourne',
    country: 'Australia',
    iana_timezone: 'Australia/Melbourne',
    gmt_timezone: 'GMT+10',
    dst_observed: 'Y',
    currency: 'AUD'
  },
  {
    fund_centre_code: 'FC-JHB',
    name: 'Johannesburg Fund Centre',
    city: 'Johannesburg',
    country: 'South Africa',
    iana_timezone: 'Africa/Johannesburg',
    gmt_timezone: 'GMT+2',
    dst_observed: 'N',
    currency: 'ZAR'
  },
  {
    fund_centre_code: 'FC-CAI',
    name: 'Cairo Fund Centre',
    city: 'Cairo',
    country: 'Egypt',
    iana_timezone: 'Africa/Cairo',
    gmt_timezone: 'GMT+2',
    dst_observed: 'Y',
    currency: 'EGP'
  },
  {
    fund_centre_code: 'FC-TOR',
    name: 'Toronto Fund Centre',
    city: 'Toronto',
    country: 'Canada',
    iana_timezone: 'America/Toronto',
    gmt_timezone: 'GMT-5',
    dst_observed: 'Y',
    currency: 'CAD'
  },
  {
    fund_centre_code: 'FC-VAN',
    name: 'Vancouver Fund Centre',
    city: 'Vancouver',
    country: 'Canada',
    iana_timezone: 'America/Vancouver',
    gmt_timezone: 'GMT-8',
    dst_observed: 'Y',
    currency: 'CAD'
  },
  {
    fund_centre_code: 'FC-SAO',
    name: 'São Paulo Fund Centre',
    city: 'São Paulo',
    country: 'Brazil',
    iana_timezone: 'America/Sao_Paulo',
    gmt_timezone: 'GMT-3',
    dst_observed: 'N',
    currency: 'BRL'
  }
];

// City coordinates mapping (from cityCoordinates.js)
const cityCoordinates = {
  'New York': { lat: 40.7128, lng: -74.0060 },
  'Chicago': { lat: 41.8781, lng: -87.6298 },
  'London': { lat: 51.5074, lng: -0.1278 },
  'Frankfurt': { lat: 50.1109, lng: 8.6821 },
  'Paris': { lat: 48.8566, lng: 2.3522 },
  'Zurich': { lat: 47.3769, lng: 8.5417 },
  'Madrid': { lat: 40.4168, lng: -3.7038 },
  'Dubai': { lat: 25.2048, lng: 55.2708 },
  'Mumbai': { lat: 19.0760, lng: 72.8777 },
  'Colombo': { lat: 6.9271, lng: 79.8612 },
  'Singapore': { lat: 1.3521, lng: 103.8198 },
  'Hong Kong': { lat: 22.3193, lng: 114.1694 },
  'Bangkok': { lat: 13.7563, lng: 100.5018 },
  'Tokyo': { lat: 35.6762, lng: 139.6503 },
  'Seoul': { lat: 37.5665, lng: 126.9780 },
  'Sydney': { lat: -33.8688, lng: 151.2093 },
  'Melbourne': { lat: -37.8136, lng: 144.9631 },
  'Johannesburg': { lat: -26.2041, lng: 28.0473 },
  'Cairo': { lat: 30.0444, lng: 31.2357 },
  'Toronto': { lat: 43.6532, lng: -79.3832 },
  'Vancouver': { lat: 49.2827, lng: -123.1207 },
  'São Paulo': { lat: -23.5505, lng: -46.6333 }
};

async function seedDefaultFundCentres() {
  try {
    console.log('Starting to seed default fund centres...');
    
    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const fundCentre of defaultFundCentres) {
      try {
        // Check if fund centre already exists
        const [existing] = await db.query(
          'SELECT id FROM fund_centre_master WHERE fund_centre_code = ?',
          [fundCentre.fund_centre_code]
        );

        if (existing && existing.length > 0) {
          console.log(`⏭ Skipping ${fundCentre.fund_centre_code} - already exists`);
          skipped++;
          continue;
        }

        // Get coordinates for the city
        const coords = cityCoordinates[fundCentre.city];
        if (!coords) {
          console.error(`❌ No coordinates found for city: ${fundCentre.city}`);
          errors++;
          continue;
        }

        // Insert fund centre
        const [result] = await db.query(
          `INSERT INTO fund_centre_master 
           (name, fund_centre_code, country, city, gmt_timezone, iana_timezone, latitude, longitude, dst_observed, currency, created_at, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            fundCentre.name,
            fundCentre.fund_centre_code,
            fundCentre.country,
            fundCentre.city,
            fundCentre.gmt_timezone,
            fundCentre.iana_timezone,
            coords.lat.toString(),
            coords.lng.toString(),
            fundCentre.dst_observed,
            fundCentre.currency
          ]
        );

        console.log(`✓ Inserted ${fundCentre.fund_centre_code} - ${fundCentre.name}`);
        inserted++;
      } catch (error) {
        console.error(`❌ Error inserting ${fundCentre.fund_centre_code}:`, error.message);
        errors++;
      }
    }

    console.log('\n=== Seeding Summary ===');
    console.log(`✓ Inserted: ${inserted}`);
    console.log(`⏭ Skipped (already exists): ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`Total processed: ${defaultFundCentres.length}`);
    
    if (errors === 0) {
      console.log('\n✅ Seeding completed successfully!');
    } else {
      console.log('\n⚠️ Seeding completed with some errors.');
    }
  } catch (error) {
    console.error('❌ Fatal error during seeding:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  seedDefaultFundCentres()
    .then(() => {
      console.log('Seed script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seed script failed:', error);
      process.exit(1);
    });
}

module.exports = seedDefaultFundCentres;
