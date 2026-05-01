const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create some users
  const user1 = await prisma.user.upsert({
    where: { username: 'sneakerhead_01' },
    update: {},
    create: {
      username: 'sneakerhead_01',
      email: 'user1@example.com',
    },
  });

  const user2 = await prisma.user.upsert({
    where: { username: 'hypebeast' },
    update: {},
    create: {
      username: 'hypebeast',
      email: 'user2@example.com',
    },
  });

  // Create some drops
  await prisma.drop.create({
    data: {
      name: 'Air Jordan 1 Retro High OG',
      description: 'The iconic "Chicago" colorway returns with a vintage aesthetic.',
      price: 180,
      totalStock: 50,
      availableStock: 50,
      imageUrl: 'https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&q=80&w=800',
    },
  });

  await prisma.drop.create({
    data: {
      name: 'Yeezy Boost 350 V2',
      description: 'Re-release of the classic "Zebra" colorway.',
      price: 220,
      totalStock: 5,
      availableStock: 5,
      imageUrl: 'https://images.unsplash.com/photo-1584735175315-9d5df23860e6?auto=format&fit=crop&q=80&w=800',
    },
  });

  await prisma.drop.create({
    data: {
      name: 'Nike Dunk Low Panda',
      description: 'The most versatile sneaker in the game.',
      price: 110,
      totalStock: 100,
      availableStock: 100,
      imageUrl: 'https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?auto=format&fit=crop&q=80&w=800',
    },
  });

  console.log('✅ Seeding completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
