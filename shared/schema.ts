import { pgTable, text, serial, integer, boolean, timestamp, decimal, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Create enums for categories
export const eventCategoryEnum = pgEnum('event_category', [
  'social', 'music', 'spiritual', 'education', 
  'sports', 'food', 'art', 'technology',
  'games', 'outdoor', 'networking', 'workshop',
  'conference', 'party', 'fair', 'exhibition'
]);

// Create enums for privacy
export const privacyTypeEnum = pgEnum('privacy_type', ['public', 'private']);

// Create enums for payment type
export const paymentTypeEnum = pgEnum('payment_type', ['free', 'paid']);

// Users Table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  bio: text("bio"),
  avatar: text("avatar"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Events Table
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: eventCategoryEnum("category").notNull(),
  date: timestamp("date").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 6 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 6 }).notNull(),
  locationName: text("location_name").notNull(),
  locationAddress: text("location_address").notNull(),
  paymentType: paymentTypeEnum("payment_type").notNull().default('free'),
  price: decimal("price", { precision: 10, scale: 2 }),
  maxCapacity: integer("max_capacity"),
  privacyType: privacyTypeEnum("privacy_type").notNull().default('public'),
  photoUrl: text("photo_url"),  // URL de la foto principal
  photoUrls: text("photo_urls"), // Lista de URLs de fotos en formato JSON
  videoUrl: text("video_url"),  // URL del video principal
  organizerId: integer("organizer_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Attendee status enum (pending, approved, rejected)
export const attendeeStatusEnum = pgEnum('attendee_status', ['pending', 'approved', 'rejected']);

// Event Attendees Junction Table
export const eventAttendees = pgTable("event_attendees", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => events.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  status: attendeeStatusEnum("status").default('approved').notNull(),
  paymentStatus: text("payment_status").default('pending'),
  paymentIntentId: text("payment_intent_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// User Interests Table (for future recommendations)
export const userInterests = pgTable("user_interests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  category: eventCategoryEnum("category").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  organizedEvents: many(events, { relationName: "organizer" }),
  attendedEvents: many(eventAttendees, { relationName: "attendee" }),
  interests: many(userInterests),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  organizer: one(users, { fields: [events.organizerId], references: [users.id], relationName: "organizer" }),
  attendees: many(eventAttendees),
}));

export const eventAttendeesRelations = relations(eventAttendees, ({ one }) => ({
  event: one(events, { fields: [eventAttendees.eventId], references: [events.id] }),
  user: one(users, { fields: [eventAttendees.userId], references: [users.id], relationName: "attendee" }),
}));

export const userInterestsRelations = relations(userInterests, ({ one }) => ({
  user: one(users, { fields: [userInterests.userId], references: [users.id] }),
}));

// Validation Schemas
export const insertUserSchema = createInsertSchema(users, {
  email: (schema) => schema.email("Dirección de correo electrónico inválida"),
  password: (schema) => schema.min(6, "La contraseña debe tener al menos 6 caracteres"),
  username: (schema) => schema.min(3, "El nombre de usuario debe tener al menos 3 caracteres"),
  name: (schema) => schema.min(2, "El nombre debe tener al menos 2 caracteres"),
});

export const loginUserSchema = z.object({
  email: z.string().email("Dirección de correo electrónico inválida"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

// Esquema personalizado con transformaciones para eventos
export const insertEventSchema = z.object({
  title: z.string().min(3, "El título debe tener al menos 3 caracteres"),
  description: z.string().min(10, "La descripción debe tener al menos 10 caracteres"),
  category: z.enum(eventCategoryEnum.enumValues),
  date: z.string().or(z.date()).transform(val => 
    typeof val === 'string' ? new Date(val) : val
  ),
  latitude: z.string().or(z.number()).transform(val => 
    typeof val === 'string' ? parseFloat(val) : val
  ),
  longitude: z.string().or(z.number()).transform(val => 
    typeof val === 'string' ? parseFloat(val) : val
  ),
  locationName: z.string().min(3, "El nombre del lugar debe tener al menos 3 caracteres"),
  locationAddress: z.string().min(5, "La dirección debe tener al menos 5 caracteres"),
  paymentType: z.enum(paymentTypeEnum.enumValues).default('free'),
  price: z.number().optional().nullable(),
  maxCapacity: z.number().optional().nullable(),
  privacyType: z.enum(privacyTypeEnum.enumValues).default('public'),
  photoUrl: z.string().optional().nullable(),
  photoUrls: z.string().optional().nullable(), // Almacenar array como JSON string
  videoUrl: z.string().optional().nullable(),
  organizerId: z.number(),
});

export const insertEventAttendeeSchema = createInsertSchema(eventAttendees);

// Export types
export type User = typeof users.$inferSelect;
export type Event = typeof events.$inferSelect;
export type EventAttendee = typeof eventAttendees.$inferSelect;
export type UserInterest = typeof userInterests.$inferSelect;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type InsertEventAttendee = z.infer<typeof insertEventAttendeeSchema>;
