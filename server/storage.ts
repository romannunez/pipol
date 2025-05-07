import { db } from "@db";
import { eq, and, desc, gte, lte, inArray } from "drizzle-orm";
import {
  users,
  events,
  eventAttendees,
  userInterests,
  type User,
  type Event,
  type EventAttendee,
  type InsertUser,
  type InsertEvent,
  type InsertEventAttendee
} from "@shared/schema";

// User related storage functions
export const getUserById = async (id: number) => {
  return db.query.users.findFirst({
    where: eq(users.id, id),
  });
};

export const getUserByEmail = async (email: string) => {
  return db.query.users.findFirst({
    where: eq(users.email, email),
  });
};

export const getUserByUsername = async (username: string) => {
  return db.query.users.findFirst({
    where: eq(users.username, username),
  });
};

export const insertUser = async (user: InsertUser) => {
  const [newUser] = await db.insert(users).values(user).returning();
  return newUser;
};

export const updateUser = async (id: number, userData: Partial<User>) => {
  const [updatedUser] = await db
    .update(users)
    .set({ ...userData, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return updatedUser;
};

export const updateStripeCustomerId = async (userId: number, stripeCustomerId: string) => {
  const [updatedUser] = await db
    .update(users)
    .set({ 
      stripeCustomerId, 
      updatedAt: new Date() 
    })
    .where(eq(users.id, userId))
    .returning();
  return updatedUser;
};

export const updateUserStripeInfo = async (userId: number, stripeInfo: { stripeCustomerId: string, stripeSubscriptionId: string }) => {
  const [updatedUser] = await db
    .update(users)
    .set({ 
      stripeCustomerId: stripeInfo.stripeCustomerId,
      stripeSubscriptionId: stripeInfo.stripeSubscriptionId,
      updatedAt: new Date() 
    })
    .where(eq(users.id, userId))
    .returning();
  return updatedUser;
};

// Event related storage functions
export const getEventById = async (id: number) => {
  return db.query.events.findFirst({
    where: eq(events.id, id),
    with: {
      organizer: true,
      attendees: {
        with: {
          user: true
        }
      }
    }
  });
};

export const getEvents = async (filters?: {
  category?: string[];
  paymentType?: string[];
  minDate?: Date;
  maxDate?: Date;
  searchTerm?: string;
  lat?: number;
  lng?: number;
  radius?: number; // in kilometers
}) => {
  let query = db.query.events.findMany({
    with: {
      organizer: true,
      attendees: true
    },
    orderBy: desc(events.date)
  });

  // This is a simplified implementation as fully featured geospatial filtering
  // would normally use PostGIS extensions. For simplicity, we can filter by lat/lng
  // within the app code after fetching the nearby events.

  return query;
};

export const getNearbyEvents = async (lat: number, lng: number, radius: number = 10) => {
  // In a real production app, this would use PostGIS for efficient geospatial queries
  // For simplicity, we'll just fetch all events and filter in memory
  const allEvents = await db.query.events.findMany({
    with: {
      organizer: true,
      attendees: {
        limit: 5,
        with: {
          user: true
        }
      }
    },
    orderBy: desc(events.date)
  });

  // Simplified distance calculation using the Haversine formula
  // In a real app, this would be done at the database level
  return allEvents.filter(event => {
    const eventLat = parseFloat(event.latitude.toString());
    const eventLng = parseFloat(event.longitude.toString());
    
    // Haversine formula
    const R = 6371; // Earth's radius in km
    const dLat = (lat - eventLat) * Math.PI / 180;
    const dLng = (lng - eventLng) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(eventLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * 
      Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    
    return distance <= radius;
  });
};

export const insertEvent = async (event: InsertEvent) => {
  try {
    console.log("Insertando evento en DB:", JSON.stringify(event));
    // Convertimos a un objeto que Drizzle pueda entender
    const eventData = {
      title: event.title,
      description: event.description,
      category: event.category,
      date: event.date instanceof Date ? event.date : new Date(event.date),
      latitude: event.latitude,
      longitude: event.longitude,
      locationName: event.locationName,
      locationAddress: event.locationAddress,
      paymentType: event.paymentType || 'free',
      price: event.price,
      maxCapacity: event.maxCapacity,
      privacyType: event.privacyType || 'public',
      organizerId: event.organizerId
    };
    
    console.log("Datos formateados para DB:", JSON.stringify(eventData));
    // Corregimos el error de tipo
    const [newEvent] = await db.insert(events).values([eventData] as any).returning();
    console.log("Evento creado exitosamente:", JSON.stringify(newEvent));
    return newEvent;
  } catch (error) {
    console.error("Error al insertar evento en la base de datos:", error);
    throw error;
  }
};

export const updateEvent = async (id: number, eventData: Partial<Event>) => {
  const [updatedEvent] = await db
    .update(events)
    .set({ ...eventData, updatedAt: new Date() })
    .where(eq(events.id, id))
    .returning();
  return updatedEvent;
};

export const deleteEvent = async (id: number) => {
  // First delete all attendees
  await db.delete(eventAttendees).where(eq(eventAttendees.eventId, id));
  
  // Then delete the event
  const [deletedEvent] = await db
    .delete(events)
    .where(eq(events.id, id))
    .returning();
  return deletedEvent;
};

// Event Attendees related storage functions
export const joinEvent = async (attendee: InsertEventAttendee) => {
  const [newAttendee] = await db.insert(eventAttendees).values(attendee).returning();
  return newAttendee;
};

export const leaveEvent = async (eventId: number, userId: number) => {
  const [removedAttendee] = await db
    .delete(eventAttendees)
    .where(
      and(
        eq(eventAttendees.eventId, eventId),
        eq(eventAttendees.userId, userId)
      )
    )
    .returning();
  return removedAttendee;
};

export const getEventAttendees = async (eventId: number) => {
  return db.query.eventAttendees.findMany({
    where: eq(eventAttendees.eventId, eventId),
    with: {
      user: true
    }
  });
};

export const getEventAttendee = async (eventId: number, userId: number) => {
  return db.query.eventAttendees.findFirst({
    where: and(
      eq(eventAttendees.eventId, eventId),
      eq(eventAttendees.userId, userId)
    )
  });
};

export const updateEventAttendee = async (id: number, attendeeData: Partial<EventAttendee>) => {
  const [updatedAttendee] = await db
    .update(eventAttendees)
    .set(attendeeData)
    .where(eq(eventAttendees.id, id))
    .returning();
  return updatedAttendee;
};

export const updatePaymentStatus = async (eventId: number, userId: number, paymentStatus: string, paymentIntentId: string) => {
  const [updatedAttendee] = await db
    .update(eventAttendees)
    .set({ 
      paymentStatus,
      paymentIntentId
    })
    .where(
      and(
        eq(eventAttendees.eventId, eventId),
        eq(eventAttendees.userId, userId)
      )
    )
    .returning();
  return updatedAttendee;
};

// User Events
export const getUserCreatedEvents = async (userId: number) => {
  return db.query.events.findMany({
    where: eq(events.organizerId, userId),
    with: {
      attendees: true
    },
    orderBy: desc(events.date)
  });
};

export const getUserAttendingEvents = async (userId: number) => {
  return db.query.eventAttendees.findMany({
    where: eq(eventAttendees.userId, userId),
    with: {
      event: {
        with: {
          organizer: true
        }
      }
    },
    orderBy: desc(eventAttendees.createdAt)
  });
};

export const storage = {
  getUserById,
  getUserByEmail,
  getUserByUsername,
  insertUser,
  updateUser,
  updateStripeCustomerId,
  updateUserStripeInfo,
  getEventById,
  getEvents,
  getNearbyEvents,
  insertEvent,
  updateEvent,
  deleteEvent,
  joinEvent,
  leaveEvent,
  getEventAttendees,
  getEventAttendee,
  updateEventAttendee,
  updatePaymentStatus,
  getUserCreatedEvents,
  getUserAttendingEvents
};
