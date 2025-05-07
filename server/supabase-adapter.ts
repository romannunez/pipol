import { createClient } from '@supabase/supabase-js';
import type { Database } from '../client/src/lib/supabase-types';

// Create server-side Supabase client
const supabaseUrl = 'https://pbvkjkjdtwftjetpreai.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBidmtqa2pkdHdmdGpldHByZWFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTY1NzY5OTgsImV4cCI6MjAzMjE1Mjk5OH0.IWWclvE5JmAPx6_vNdqRWnCKiUZ2R_FJ7UDcQskuKME';
const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
import { 
  Event, EventAttendee, Profile, UserInterest, 
  NewEvent, NewEventAttendee, NewProfile, NewUserInterest,
  UpdateEvent, UpdateEventAttendee, UpdateProfile, UpdateUserInterest
} from '../client/src/lib/supabase-types';

// Profile related functions
export const getProfileById = async (id: string): Promise<Profile | undefined> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .single();
  
  if (error || !data) return undefined;
  return data as Profile;
};

export const getProfileByUsername = async (username: string): Promise<Profile | undefined> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', username)
    .single();
  
  if (error || !data) return undefined;
  return data as Profile;
};

export const createProfile = async (profile: NewProfile): Promise<Profile | undefined> => {
  const { data, error } = await supabase
    .from('profiles')
    .insert([profile])
    .select()
    .single();
  
  if (error || !data) {
    console.error('Error creating profile:', error);
    return undefined;
  }
  
  return data as Profile;
};

export const updateProfile = async (id: string, profile: UpdateProfile): Promise<Profile | undefined> => {
  const { data, error } = await supabase
    .from('profiles')
    .update(profile)
    .eq('id', id)
    .select()
    .single();
  
  if (error || !data) {
    console.error('Error updating profile:', error);
    return undefined;
  }
  
  return data as Profile;
};

// Event related functions
export const getEventById = async (id: number): Promise<Event | undefined> => {
  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      organizer:profiles(*),
      attendees:event_attendees(*)
    `)
    .eq('id', id)
    .single();
  
  if (error || !data) return undefined;
  return data as Event;
};

export const getEvents = async (filters?: {
  category?: string[];
  paymentType?: string[];
  minDate?: Date;
  maxDate?: Date;
  searchTerm?: string;
}): Promise<Event[]> => {
  let query = supabase
    .from('events')
    .select(`
      *,
      organizer:profiles(*),
      attendees:event_attendees(*)
    `);
  
  // Apply filters
  if (filters?.category && filters.category.length > 0) {
    query = query.in('category', filters.category);
  }
  
  if (filters?.paymentType && filters.paymentType.length > 0) {
    query = query.in('payment_type', filters.paymentType);
  }
  
  if (filters?.minDate) {
    query = query.gte('date', filters.minDate.toISOString());
  }
  
  if (filters?.maxDate) {
    query = query.lte('date', filters.maxDate.toISOString());
  }
  
  if (filters?.searchTerm) {
    query = query.or(`title.ilike.%${filters.searchTerm}%,description.ilike.%${filters.searchTerm}%`);
  }
  
  const { data, error } = await query.order('date', { ascending: true });
  
  if (error) {
    console.error('Error fetching events:', error);
    return [];
  }
  
  return data as Event[];
};

export const getNearbyEvents = async (lat: number, lng: number, radius: number = 10): Promise<Event[]> => {
  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      organizer:profiles(*),
      attendees:event_attendees(*)
    `)
    .order('date', { ascending: true });
  
  if (error) {
    console.error('Error fetching nearby events:', error);
    return [];
  }
  
  // Filter by distance client-side
  return (data as Event[]).filter(event => {
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

export const createEvent = async (event: NewEvent): Promise<Event | undefined> => {
  const { data, error } = await supabase
    .from('events')
    .insert([event])
    .select()
    .single();
  
  if (error) {
    console.error('Error creating event:', error);
    return undefined;
  }
  
  return data as Event;
};

export const updateEvent = async (id: number, event: UpdateEvent): Promise<Event | undefined> => {
  const { data, error } = await supabase
    .from('events')
    .update(event)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating event:', error);
    return undefined;
  }
  
  return data as Event;
};

export const deleteEvent = async (id: number): Promise<Event | undefined> => {
  // First, delete attendees
  await supabase
    .from('event_attendees')
    .delete()
    .eq('event_id', id);
  
  // Then delete the event
  const { data, error } = await supabase
    .from('events')
    .delete()
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error deleting event:', error);
    return undefined;
  }
  
  return data as Event;
};

// Event attendance functions
export const joinEvent = async (attendee: NewEventAttendee): Promise<EventAttendee | undefined> => {
  const { data, error } = await supabase
    .from('event_attendees')
    .insert([attendee])
    .select()
    .single();
  
  if (error) {
    console.error('Error joining event:', error);
    return undefined;
  }
  
  return data as EventAttendee;
};

export const leaveEvent = async (eventId: number, userId: string): Promise<EventAttendee | undefined> => {
  const { data, error } = await supabase
    .from('event_attendees')
    .delete()
    .match({ event_id: eventId, user_id: userId })
    .select()
    .single();
  
  if (error) {
    console.error('Error leaving event:', error);
    return undefined;
  }
  
  return data as EventAttendee;
};

export const getEventAttendees = async (eventId: number): Promise<EventAttendee[]> => {
  const { data, error } = await supabase
    .from('event_attendees')
    .select(`
      *,
      profile:profiles(*)
    `)
    .eq('event_id', eventId);
  
  if (error) {
    console.error('Error fetching event attendees:', error);
    return [];
  }
  
  return data as EventAttendee[];
};

export const getEventAttendee = async (eventId: number, userId: string): Promise<EventAttendee | undefined> => {
  const { data, error } = await supabase
    .from('event_attendees')
    .select()
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .single();
  
  if (error || !data) return undefined;
  return data as EventAttendee;
};

export const updateEventAttendee = async (id: number, attendee: UpdateEventAttendee): Promise<EventAttendee | undefined> => {
  const { data, error } = await supabase
    .from('event_attendees')
    .update(attendee)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating event attendee:', error);
    return undefined;
  }
  
  return data as EventAttendee;
};

export const updatePaymentStatus = async (
  eventId: number, 
  userId: string, 
  paymentStatus: string, 
  paymentIntentId: string
): Promise<EventAttendee | undefined> => {
  const { data, error } = await supabase
    .from('event_attendees')
    .update({
      payment_status: paymentStatus,
      payment_intent_id: paymentIntentId
    })
    .match({ event_id: eventId, user_id: userId })
    .select()
    .single();
  
  if (error) {
    console.error('Error updating payment status:', error);
    return undefined;
  }
  
  return data as EventAttendee;
};

// User events
export const getUserCreatedEvents = async (userId: string): Promise<Event[]> => {
  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      attendees:event_attendees(*)
    `)
    .eq('organizer_id', userId)
    .order('date', { ascending: true });
  
  if (error) {
    console.error('Error fetching user created events:', error);
    return [];
  }
  
  return data as Event[];
};

export const getUserAttendingEvents = async (userId: string): Promise<Event[]> => {
  const { data, error } = await supabase
    .from('event_attendees')
    .select(`
      *,
      event:events(
        *,
        organizer:profiles(*)
      )
    `)
    .eq('user_id', userId);
  
  if (error) {
    console.error('Error fetching user attending events:', error);
    return [];
  }
  
  // Extract events from attendees
  return data.map(attendee => attendee.event) as Event[];
};

// User interests
export const getUserInterests = async (userId: string): Promise<UserInterest[]> => {
  const { data, error } = await supabase
    .from('user_interests')
    .select('*')
    .eq('user_id', userId);
  
  if (error) {
    console.error('Error fetching user interests:', error);
    return [];
  }
  
  return data as UserInterest[];
};

export const addUserInterest = async (interest: NewUserInterest): Promise<UserInterest | undefined> => {
  const { data, error } = await supabase
    .from('user_interests')
    .insert([interest])
    .select()
    .single();
  
  if (error) {
    console.error('Error adding user interest:', error);
    return undefined;
  }
  
  return data as UserInterest;
};

export const removeUserInterest = async (id: number): Promise<UserInterest | undefined> => {
  const { data, error } = await supabase
    .from('user_interests')
    .delete()
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error removing user interest:', error);
    return undefined;
  }
  
  return data as UserInterest;
};

// Export all functions as a storage object
export const supabaseStorage = {
  getProfileById,
  getProfileByUsername,
  createProfile,
  updateProfile,
  getEventById,
  getEvents,
  getNearbyEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  joinEvent,
  leaveEvent,
  getEventAttendees,
  getEventAttendee,
  updateEventAttendee,
  updatePaymentStatus,
  getUserCreatedEvents,
  getUserAttendingEvents,
  getUserInterests,
  addUserInterest,
  removeUserInterest
};