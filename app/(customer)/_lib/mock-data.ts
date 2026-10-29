/**
 * Fixtures for the mock customer API (api.ts). Three sample brands, their jobs, and past requests.
 * Delete this file when api.ts switches to real fetch calls.
 */
import type { AccessMode, Branding, FailCode, InputObject, Job, RequestStatus, ReviewMode } from './types';

export type MockBot = {
  agent_id: string;
  token: string;
  link_kind: 'public' | 'personal';
  access_mode: AccessMode;
  /** Section 16; returned by R4 since section 17.7. */
  review_mode: ReviewMode;
  branding: Branding;
  daily_cap: number;
  used_today: number;
  jobs: Job[];
};

export type MockRequestFixture = {
  id: string;
  agent_id: string;
  offer: string;
  status: RequestStatus;
  input: InputObject | null;
  notes: string;
  question?: string | null;
  answers?: { question: string; answer: string; asked_at: string; answered_at: string }[];
  result?: Record<string, unknown> | null;
  fail_code?: FailCode | null;
  fail_message?: string | null;
  /** Mock only: a question the bot asked that the owner hasn't released yet (section 17.8). */
  held_question?: string | null;
  created_at: string;
  updated_at: string;
};

export const ACME_ID = '3f8a1c2e-7b4d-4e19-9a6c-1d2e3f4a5b01';
export const NORTHLINE_ID = '9b2d4f6a-1c3e-4a5b-8d7f-2e4a6c8b0d02';
export const FERNWOOD_ID = 'c7e9a1b3-5d2f-4c6e-9b8a-3f5d7b9c1e03';

const CA_POSTAL = '^[A-Za-z]\\d[A-Za-z] ?\\d[A-Za-z]\\d$';

export const MOCK_BOTS: MockBot[] = [
  {
    agent_id: ACME_ID,
    token: 'acme-jewellers',
    link_kind: 'public',
    access_mode: 'open_link',
    review_mode: 'review_first',
    daily_cap: 20,
    used_today: 2,
    branding: {
      display_name: 'Acme Jewellers',
      logo_url: '/valetto-mock/acme-logo.webp',
      logo_width: 256,
      logo_height: 256,
      primary_color: '#6E1F3F',
      primary_foreground: '#FFFFFF',
      accent_color: '#C9962E',
      accent_foreground: '#000000',
      primary_on_white_ok: true,
      on_primary: 'white',
      show_footer: true,
    },
    jobs: [
      {
        name: 'render_ring',
        title: 'Render my ring',
        description: 'See your ring design before we make it. We send a preview and a price.',
        input_schema: {
          type: 'object',
          title: 'Render my ring',
          properties: {
            metal: {
              type: 'string',
              title: 'Metal',
              enum: ['yellow_gold', 'white_gold', 'rose_gold', 'platinum'],
              'x-enum-titles': ['Yellow gold', 'White gold', 'Rose gold', 'Platinum'],
            },
            stone: {
              type: 'string',
              title: 'Centre stone',
              enum: ['diamond', 'lab_diamond', 'sapphire', 'emerald', 'ruby', 'moissanite', 'none'],
              'x-enum-titles': ['Diamond', 'Lab-grown diamond', 'Sapphire', 'Emerald', 'Ruby', 'Moissanite', 'No stone'],
            },
            carat: { type: 'number', title: 'Carat', description: 'From 0.25 to 5.', minimum: 0.25, maximum: 5 },
            ring_size: { type: 'integer', title: 'Ring size', description: 'Canadian sizes 3 to 13.', minimum: 3, maximum: 13, default: 6 },
            engraving: { type: 'string', title: 'Engraving', description: 'Up to 30 characters.', maxLength: 30 },
            extras: {
              type: 'array',
              title: 'Extras',
              maxItems: 2,
              uniqueItems: true,
              items: { type: 'string', enum: ['matching_band', 'gift_box', 'care_kit'], 'x-enum-titles': ['Matching band', 'Gift box', 'Care kit'] },
            },
            rush: { type: 'boolean', title: 'Rush order', description: 'Ready in 2 weeks instead of 5.' },
          },
          required: ['metal', 'stone', 'ring_size'],
          additionalProperties: false,
          'x-order': ['metal', 'stone', 'carat', 'ring_size', 'engraving', 'extras', 'rush'],
        },
        notes_enabled: true,
        notes_max: 2000,
        result_fields: [
          { key: 'preview_url', label: 'Preview', type: 'string' },
          { key: 'price_cad', label: 'Price (CAD)', type: 'number' },
          { key: 'ready_in_weeks', label: 'Ready in (weeks)', type: 'integer' },
          { key: 'message', label: 'Message', type: 'string' },
        ],
      },
      {
        name: 'order_status',
        title: 'Check order status',
        description: 'Check where your order is. Have your order number ready.',
        input_schema: {
          type: 'object',
          title: 'Check order status',
          properties: {
            order_number: {
              type: 'string',
              title: 'Order number',
              description: 'On your receipt, like AJ-12345.',
              maxLength: 8,
              pattern: '^AJ-\\d{5}$',
            },
          },
          required: ['order_number'],
          additionalProperties: false,
          'x-order': ['order_number'],
        },
        notes_enabled: false,
        notes_max: 0,
        result_fields: [
          { key: 'status', label: 'Status', type: 'string' },
          { key: 'ready_date', label: 'Ready date', type: 'string' },
          { key: 'pickup', label: 'Pickup', type: 'boolean' },
        ],
      },
    ],
  },
  {
    agent_id: NORTHLINE_ID,
    token: 'northline-windows',
    link_kind: 'public',
    access_mode: 'approve_each',
    review_mode: 'auto',
    daily_cap: 20,
    used_today: 1,
    branding: {
      display_name: 'Northline Windows',
      logo_url: '/valetto-mock/northline-logo.webp',
      logo_width: 256,
      logo_height: 256,
      primary_color: '#1D4E89',
      primary_foreground: '#FFFFFF',
      accent_color: '#E8A33D',
      accent_foreground: '#000000',
      primary_on_white_ok: true,
      on_primary: '#FFFFFF',
      show_footer: true,
    },
    jobs: [
      {
        name: 'window_quote',
        title: 'Get a window quote',
        description: 'Get a price for new windows, with install. We reply within one business day.',
        input_schema: {
          type: 'object',
          title: 'Get a window quote',
          properties: {
            window_type: {
              type: 'string',
              title: 'Window type',
              enum: ['casement', 'sliding', 'double_hung', 'picture'],
              'x-enum-titles': ['Casement', 'Sliding', 'Double-hung', 'Picture'],
            },
            width_cm: { type: 'integer', title: 'Width (cm)', minimum: 30, maximum: 300 },
            height_cm: { type: 'integer', title: 'Height (cm)', minimum: 30, maximum: 300 },
            count: { type: 'integer', title: 'How many', minimum: 1, maximum: 40, default: 1 },
            glass: {
              type: 'array',
              title: 'Glass options',
              uniqueItems: true,
              items: { type: 'string', enum: ['triple_pane', 'low_e', 'tinted'], 'x-enum-titles': ['Triple pane', 'Low-E coating', 'Tinted'] },
            },
            removal: { type: 'boolean', title: 'Remove old windows', default: true },
            postal_code: { type: 'string', title: 'Postal code', maxLength: 7, pattern: CA_POSTAL },
          },
          required: ['window_type', 'width_cm', 'height_cm', 'count', 'postal_code'],
          additionalProperties: false,
          'x-order': ['window_type', 'width_cm', 'height_cm', 'count', 'glass', 'removal', 'postal_code'],
        },
        notes_enabled: true,
        notes_max: 2000,
        result_fields: [
          { key: 'price_cad', label: 'Price (CAD)', type: 'number' },
          { key: 'install_weeks', label: 'Install in (weeks)', type: 'integer' },
          { key: 'includes', label: 'Includes', type: 'array' },
          { key: 'message', label: 'Message', type: 'string' },
        ],
      },
      {
        name: 'measuring_visit',
        title: 'Book a measuring visit',
        description: 'Book a free visit to measure your windows. It takes about 30 minutes.',
        input_schema: {
          type: 'object',
          title: 'Book a measuring visit',
          properties: {
            preferred_day: {
              type: 'string',
              title: 'Preferred day',
              enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
              'x-enum-titles': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
            },
            time_window: {
              type: 'string',
              title: 'Time',
              enum: ['morning', 'afternoon', 'evening'],
              'x-enum-titles': ['Morning', 'Afternoon', 'Evening'],
            },
            address: { type: 'string', title: 'Address', description: 'Street, unit and city.', maxLength: 200, minLength: 5 },
            phone: { type: 'string', title: 'Phone', description: 'So the crew can call when they arrive.', maxLength: 20, pattern: '^[0-9 ()+-]{7,20}$' },
          },
          required: ['preferred_day', 'time_window', 'address'],
          additionalProperties: false,
          'x-order': ['preferred_day', 'time_window', 'address', 'phone'],
        },
        notes_enabled: true,
        notes_max: 2000,
        result_fields: [
          { key: 'visit_date', label: 'Visit date', type: 'string' },
          { key: 'arrival_window', label: 'Arrival window', type: 'string' },
          { key: 'message', label: 'Message', type: 'string' },
        ],
      },
    ],
  },
  {
    agent_id: FERNWOOD_ID,
    token: 'fernwood-furniture',
    link_kind: 'personal',
    access_mode: 'open_link',
    review_mode: 'auto',
    daily_cap: 20,
    used_today: 0,
    branding: {
      display_name: 'Fernwood Furniture',
      // No logo and no accent: shows the initials tile and the main-color fallback.
      logo_url: null,
      logo_width: null,
      logo_height: null,
      primary_color: '#9A3D22',
      primary_foreground: '#FFFFFF',
      accent_color: null,
      accent_foreground: null,
      show_footer: true,
    },
    jobs: [
      {
        name: 'delivery_status',
        title: "Where's my delivery?",
        description: 'See where your delivery is and when it should arrive.',
        input_schema: {
          type: 'object',
          title: "Where's my delivery?",
          properties: {
            order_number: { type: 'string', title: 'Order number', description: 'Like FW123456.', maxLength: 8, pattern: '^FW\\d{6}$' },
            postal_code: { type: 'string', title: 'Delivery postal code', maxLength: 7, pattern: CA_POSTAL },
          },
          required: ['order_number'],
          additionalProperties: false,
          'x-order': ['order_number', 'postal_code'],
        },
        notes_enabled: false,
        notes_max: 0,
        result_fields: [
          { key: 'status', label: 'Status', type: 'string' },
          { key: 'eta', label: 'Expected', type: 'string' },
          { key: 'tracking_url', label: 'Tracking', type: 'string' },
        ],
      },
      {
        name: 'change_delivery_date',
        title: 'Change my delivery date',
        description: 'Move your delivery to another day. We confirm by email.',
        input_schema: {
          type: 'object',
          title: 'Change my delivery date',
          properties: {
            order_number: { type: 'string', title: 'Order number', description: 'Like FW123456.', maxLength: 8, pattern: '^FW\\d{6}$' },
            new_date: { type: 'string', title: 'New date', description: 'Year, month, day: 2026-11-14.', maxLength: 10, pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            time_window: {
              type: 'string',
              title: 'Time window',
              enum: ['morning', 'afternoon', 'any'],
              'x-enum-titles': ['Morning', 'Afternoon', 'Any time'],
              default: 'any',
            },
            flexible: { type: 'boolean', title: 'A day either side is fine' },
          },
          required: ['order_number', 'new_date'],
          additionalProperties: false,
          'x-order': ['order_number', 'new_date', 'time_window', 'flexible'],
        },
        notes_enabled: true,
        notes_max: 2000,
        result_fields: [
          { key: 'confirmed_date', label: 'Confirmed date', type: 'string' },
          { key: 'time_window', label: 'Time window', type: 'string' },
          { key: 'message', label: 'Message', type: 'string' },
        ],
      },
      {
        name: 'something_else',
        title: 'Something else',
        description: 'Anything else about your order. Tell us in a few words.',
        input_schema: null,
        notes_enabled: true,
        notes_max: 2000,
        result_fields: [{ key: 'message', label: 'Reply', type: 'string' }],
      },
    ],
  },
];

export const MOCK_EMAIL = 'sam.lee@example.com';

/** Past requests, newest first per bot. Times are fixed so screenshots stay stable. */
export const MOCK_REQUESTS: MockRequestFixture[] = [
  // Acme Jewellers (review first)
  {
    id: 'a0f1c2d3-1111-4a2b-9c3d-4e5f6a7b8c01',
    agent_id: ACME_ID,
    offer: 'render_ring',
    status: 'in_review',
    input: { metal: 'rose_gold', stone: 'sapphire', carat: 1.2, ring_size: 6, extras: ['gift_box'], rush: false },
    notes: 'Oval sapphire if you have one.',
    created_at: '2026-10-29T11:02:00.000Z',
    updated_at: '2026-10-29T11:02:00.000Z',
  },
  {
    id: 'a0f1c2d3-2222-4a2b-9c3d-4e5f6a7b8c02',
    agent_id: ACME_ID,
    offer: 'render_ring',
    status: 'awaiting_release',
    input: { metal: 'white_gold', stone: 'lab_diamond', carat: 1.5, ring_size: 7, engraving: 'Always, M', extras: ['matching_band'], rush: true },
    notes: '',
    result: { preview_url: 'https://example.com/previews/ring-2222.webp', price_cad: 3890, ready_in_weeks: 2, message: 'Rush slot held for you.' },
    created_at: '2026-10-28T19:40:00.000Z',
    updated_at: '2026-10-29T09:15:00.000Z',
  },
  {
    id: 'a0f1c2d3-3333-4a2b-9c3d-4e5f6a7b8c03',
    agent_id: ACME_ID,
    offer: 'order_status',
    status: 'done',
    input: { order_number: 'AJ-40213' },
    notes: '',
    result: { status: 'Ready for pickup', ready_date: 'Oct 27, 2026', pickup: true },
    created_at: '2026-10-27T15:20:00.000Z',
    updated_at: '2026-10-27T16:05:00.000Z',
  },
  {
    id: 'a0f1c2d3-4444-4a2b-9c3d-4e5f6a7b8c04',
    agent_id: ACME_ID,
    offer: 'render_ring',
    status: 'failed',
    input: { metal: 'platinum', stone: 'ruby', carat: 4.5, ring_size: 9, rush: true },
    notes: '',
    fail_code: 'declined_by_owner',
    created_at: '2026-10-24T13:10:00.000Z',
    updated_at: '2026-10-24T17:45:00.000Z',
  },
  {
    // The bot asked a question, but the owner hasn't released it yet: the customer sees only "being reviewed".
    id: 'a0f1c2d3-5555-4a2b-9c3d-4e5f6a7b8c05',
    agent_id: ACME_ID,
    offer: 'render_ring',
    status: 'awaiting_release',
    input: { metal: 'yellow_gold', stone: 'emerald', carat: 0.75, ring_size: 5, engraving: 'J + R', rush: false },
    notes: '',
    held_question: 'Do you want the engraving in script or block letters?',
    created_at: '2026-10-29T10:30:00.000Z',
    updated_at: '2026-10-29T11:05:00.000Z',
  },
  // Northline Windows (auto)
  {
    id: 'b1e2d3c4-1111-4b2c-8d3e-5f6a7b8c9d01',
    agent_id: NORTHLINE_ID,
    offer: 'measuring_visit',
    status: 'needs_info',
    input: { preferred_day: 'sat', time_window: 'morning', address: '42 Birchmount Rd, Unit 3, Toronto', phone: '416 555 0142' },
    notes: 'The side gate is locked. Please ring the front door.',
    question: 'Is there parking for a van on your street on Saturday morning?',
    created_at: '2026-10-29T10:30:00.000Z',
    updated_at: '2026-10-29T10:41:00.000Z',
  },
  {
    id: 'b1e2d3c4-2222-4b2c-8d3e-5f6a7b8c9d02',
    agent_id: NORTHLINE_ID,
    offer: 'window_quote',
    status: 'done',
    input: { window_type: 'casement', width_cm: 90, height_cm: 120, count: 6, glass: ['triple_pane', 'low_e'], removal: true, postal_code: 'M4C 1B5' },
    notes: 'Two of them are on the second floor.',
    answers: [
      {
        question: 'Are the second-floor windows reachable from inside for install?',
        answer: 'Yes, both open into bedrooms.',
        asked_at: '2026-10-26T14:10:00.000Z',
        answered_at: '2026-10-26T14:32:00.000Z',
      },
    ],
    result: {
      price_cad: 7340,
      install_weeks: 4,
      includes: ['Removal', 'Install', 'Trim', '10-year warranty'],
      message: 'Price includes <b>install</b> and disposal. Valid for 30 days.',
    },
    created_at: '2026-10-26T13:55:00.000Z',
    updated_at: '2026-10-26T16:20:00.000Z',
  },
  {
    id: 'b1e2d3c4-3333-4b2c-8d3e-5f6a7b8c9d03',
    agent_id: NORTHLINE_ID,
    offer: 'window_quote',
    status: 'failed',
    input: { window_type: 'picture', width_cm: 280, height_cm: 240, count: 1, removal: false, postal_code: 'K1A 0B1' },
    notes: '',
    fail_code: 'bot_failed',
    fail_message: "We don't install outside the Greater Toronto Area yet.",
    created_at: '2026-10-20T09:05:00.000Z',
    updated_at: '2026-10-20T10:12:00.000Z',
  },
  // Fernwood Furniture (auto)
  {
    id: 'c2f3e4d5-1111-4c2d-9e3f-6a7b8c9d0e01',
    agent_id: FERNWOOD_ID,
    offer: 'change_delivery_date',
    status: 'open',
    input: { order_number: 'FW204418', new_date: '2026-11-14', time_window: 'morning', flexible: true },
    notes: '',
    created_at: '2026-10-29T11:20:00.000Z',
    updated_at: '2026-10-29T11:20:00.000Z',
  },
  {
    id: 'c2f3e4d5-2222-4c2d-9e3f-6a7b8c9d0e02',
    agent_id: FERNWOOD_ID,
    offer: 'delivery_status',
    status: 'done',
    input: { order_number: 'FW204418', postal_code: 'M6J 1E2' },
    notes: '',
    result: {
      status: 'On the truck',
      eta: 'Thursday, Oct 29, between 1 and 4 pm',
      tracking_url: 'https://example.com/track/FW204418',
      crew: { lead: 'Dana', size: 2 },
    },
    created_at: '2026-10-29T08:12:00.000Z',
    updated_at: '2026-10-29T08:40:00.000Z',
  },
  {
    id: 'c2f3e4d5-3333-4c2d-9e3f-6a7b8c9d0e03',
    agent_id: FERNWOOD_ID,
    offer: 'something_else',
    status: 'done',
    input: null,
    notes: 'Can the crew take the old sofa away when they deliver?',
    result: { message: 'Yes. Old furniture pickup is $60, paid at the door.' },
    created_at: '2026-10-22T16:00:00.000Z',
    updated_at: '2026-10-22T17:10:00.000Z',
  },
  {
    id: 'c2f3e4d5-4444-4c2d-9e3f-6a7b8c9d0e04',
    agent_id: FERNWOOD_ID,
    offer: 'change_delivery_date',
    status: 'failed',
    input: { order_number: 'FW198230', new_date: '2026-10-20', time_window: 'any', flexible: false },
    notes: '',
    fail_code: 'expired',
    created_at: '2026-10-15T14:00:00.000Z',
    updated_at: '2026-10-17T14:00:00.000Z',
  },
  {
    id: 'c2f3e4d5-5555-4c2d-9e3f-6a7b8c9d0e05',
    agent_id: FERNWOOD_ID,
    offer: 'delivery_status',
    status: 'failed',
    input: { order_number: 'FW190077', postal_code: 'M4L 2A1' },
    notes: '',
    fail_code: 'bot_failed',
    fail_message: null,
    created_at: '2026-10-12T18:30:00.000Z',
    updated_at: '2026-10-12T18:31:00.000Z',
  },
];
