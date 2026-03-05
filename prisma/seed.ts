import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Create demo user
  const passwordHash = await hash("demo1234", 12);
  const user = await prisma.user.upsert({
    where: { email: "rahul@restaurant.com" },
    update: {},
    create: {
      name: "Rahul Sharma",
      email: "rahul@restaurant.com",
      passwordHash,
    },
  });

  // Create restaurant
  const restaurant = await prisma.restaurant.create({
    data: {
      name: "Saffron House",
      phone: "+91 98765 43210",
      city: "Pune, Maharashtra",
      upiId: "saffronhouse@upi",
      serviceMode: "DINE_IN",
      userId: user.id,
    },
  });

  // Create subscription (Growth plan, active)
  const subscription = await prisma.subscription.create({
    data: {
      plan: "GROWTH",
      status: "ACTIVE",
      startDate: new Date("2026-01-26"),
      endDate: new Date("2026-03-26"),
      restaurantId: restaurant.id,
    },
  });

  // Create invoices
  await prisma.invoice.createMany({
    data: [
      {
        invoiceNumber: "INV-2026-002",
        subscriptionId: subscription.id,
        amount: 1499,
        status: "PAID",
        date: new Date("2026-02-01"),
      },
      {
        invoiceNumber: "INV-2025-012",
        subscriptionId: subscription.id,
        amount: 999,
        status: "PAID",
        date: new Date("2025-12-01"),
      },
    ],
  });

  // Create menu categories
  const starters = await prisma.menuCategory.create({
    data: { name: "Starters", emoji: "🥗", sortOrder: 1, restaurantId: restaurant.id },
  });
  const mains = await prisma.menuCategory.create({
    data: { name: "Mains", emoji: "🍛", sortOrder: 2, restaurantId: restaurant.id },
  });
  const breads = await prisma.menuCategory.create({
    data: { name: "Breads", emoji: "🫓", sortOrder: 3, restaurantId: restaurant.id },
  });
  const desserts = await prisma.menuCategory.create({
    data: { name: "Desserts", emoji: "🍨", sortOrder: 4, restaurantId: restaurant.id },
  });

  // Create menu items
  const menuItems = await Promise.all([
    prisma.menuItem.create({ data: { name: "Paneer Tikka", description: "Char-grilled cottage cheese with mint chutney", price: 280, type: "VEG", categoryId: starters.id } }),
    prisma.menuItem.create({ data: { name: "Chicken Seekh Kebab", description: "Minced chicken on skewers, smoky & spiced", price: 350, type: "NON_VEG", categoryId: starters.id } }),
    prisma.menuItem.create({ data: { name: "Veg Spring Rolls", description: "Crispy rolls with seasoned vegetables", price: 220, type: "VEG", categoryId: starters.id } }),
    prisma.menuItem.create({ data: { name: "Butter Chicken", description: "Classic tomato-cream gravy, slow-cooked chicken", price: 420, type: "NON_VEG", categoryId: mains.id } }),
    prisma.menuItem.create({ data: { name: "Dal Makhani", description: "Black lentils simmered overnight with butter", price: 320, type: "VEG", categoryId: mains.id } }),
    prisma.menuItem.create({ data: { name: "Palak Paneer", description: "Cottage cheese in spinach gravy", price: 340, type: "VEG", categoryId: mains.id } }),
    prisma.menuItem.create({ data: { name: "Lamb Rogan Josh", description: "Aromatic Kashmiri lamb curry", price: 520, type: "NON_VEG", categoryId: mains.id } }),
    prisma.menuItem.create({ data: { name: "Garlic Naan", description: "Soft bread with garlic butter", price: 80, type: "VEG", categoryId: breads.id } }),
    prisma.menuItem.create({ data: { name: "Laccha Paratha", description: "Layered flaky whole wheat bread", price: 70, type: "VEG", categoryId: breads.id } }),
    prisma.menuItem.create({ data: { name: "Mango Kulfi", description: "Traditional Indian mango ice cream", price: 180, type: "VEG", categoryId: desserts.id } }),
    prisma.menuItem.create({ data: { name: "Gulab Jamun", description: "Deep-fried milk dumplings in sugar syrup", price: 150, type: "VEG", categoryId: desserts.id } }),
  ]);

  // Create 8 tables
  const tables = await Promise.all(
    [
      { num: 1, cap: 4, status: "OCCUPIED" as const, label: "Table 1" },
      { num: 2, cap: 2, status: "FREE" as const, label: "Table 2" },
      { num: 3, cap: 6, status: "OCCUPIED" as const, label: "Table 3" },
      { num: 4, cap: 4, status: "FREE" as const, label: "Table 4" },
      { num: 5, cap: 2, status: "OCCUPIED" as const, label: "Table 5" },
      { num: 6, cap: 8, status: "OCCUPIED" as const, label: "Table 6" },
      { num: 7, cap: 4, status: "OCCUPIED" as const, label: "Table 7" },
      { num: 8, cap: 4, status: "FREE" as const, label: "Table 8" },
    ].map((t) =>
      prisma.diningTable.create({
        data: {
          tableNumber: t.num,
          label: t.label,
          capacity: t.cap,
          active: true,
          status: t.status,
          restaurantId: restaurant.id,
        },
      })
    )
  );

  // Helper to find menu item
  const mi = (name: string) => menuItems.find((m) => m.name === name)!;

  // Create orders
  const orderData = [
    {
      code: "#T7-0241", tableIdx: 6, phone: "+91 98765 00007", status: "NEW" as const,
      special: "Less spicy please",
      items: [{ item: mi("Butter Chicken"), qty: 1 }, { item: mi("Garlic Naan"), qty: 2 }, { item: mi("Dal Makhani"), qty: 1 }],
      placedAt: new Date("2026-02-26T20:42:00"), confirmedAt: new Date("2026-02-26T20:43:00"),
    },
    {
      code: "#T3-0240", tableIdx: 2, phone: "+91 98765 00003", status: "COOKING" as const,
      special: "",
      items: [{ item: mi("Paneer Tikka"), qty: 1 }, { item: mi("Lamb Rogan Josh"), qty: 1 }, { item: mi("Laccha Paratha"), qty: 2 }],
      placedAt: new Date("2026-02-26T20:33:00"), confirmedAt: new Date("2026-02-26T20:34:00"),
      cookingAt: new Date("2026-02-26T20:35:00"),
    },
    {
      code: "#T5-0239", tableIdx: 4, phone: "+91 98765 00005", status: "READY" as const,
      special: "Extra syrup",
      items: [{ item: mi("Mango Kulfi"), qty: 2 }, { item: mi("Gulab Jamun"), qty: 1 }],
      placedAt: new Date("2026-02-26T20:26:00"), confirmedAt: new Date("2026-02-26T20:27:00"),
      cookingAt: new Date("2026-02-26T20:28:00"), readyAt: new Date("2026-02-26T20:46:00"),
    },
    {
      code: "#T1-0238", tableIdx: 0, phone: "+91 98765 00001", status: "BILLED" as const,
      special: "",
      items: [{ item: mi("Veg Spring Rolls"), qty: 1 }, { item: mi("Butter Chicken"), qty: 1 }, { item: mi("Garlic Naan"), qty: 1 }],
      placedAt: new Date("2026-02-26T20:12:00"), confirmedAt: new Date("2026-02-26T20:13:00"),
      cookingAt: new Date("2026-02-26T20:14:00"), readyAt: new Date("2026-02-26T20:32:00"),
      billedAt: new Date("2026-02-26T20:38:00"),
    },
    {
      code: "#T6-0237", tableIdx: 5, phone: "+91 98765 00006", status: "SETTLED" as const,
      special: "",
      items: [{ item: mi("Dal Makhani"), qty: 1 }, { item: mi("Palak Paneer"), qty: 1 }, { item: mi("Laccha Paratha"), qty: 3 }],
      placedAt: new Date("2026-02-26T19:57:00"), confirmedAt: new Date("2026-02-26T19:58:00"),
      cookingAt: new Date("2026-02-26T19:59:00"), readyAt: new Date("2026-02-26T20:18:00"),
      billedAt: new Date("2026-02-26T20:44:00"), settledAt: new Date("2026-02-26T20:51:00"),
    },
  ];

  for (const od of orderData) {
    const subtotal = od.items.reduce((s, i) => s + i.item.price * i.qty, 0);
    const tax = Math.round(subtotal * 0.05);
    await prisma.order.create({
      data: {
        orderCode: od.code,
        tableId: tables[od.tableIdx].id,
        restaurantId: restaurant.id,
        customerPhone: od.phone,
        status: od.status,
        specialNote: od.special,
        subtotal,
        tax,
        total: subtotal + tax,
        placedAt: od.placedAt,
        confirmedAt: od.confirmedAt || null,
        cookingAt: (od as Record<string, unknown>).cookingAt as Date || null,
        readyAt: (od as Record<string, unknown>).readyAt as Date || null,
        billedAt: (od as Record<string, unknown>).billedAt as Date || null,
        settledAt: (od as Record<string, unknown>).settledAt as Date || null,
        items: {
          create: od.items.map((i) => ({
            menuItemId: i.item.id,
            quantity: i.qty,
            unitPrice: i.item.price,
          })),
        },
      },
    });
  }

  console.log("Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
