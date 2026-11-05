import { customFetch } from '@workspace/api-client-react';

export type Ticket = { id: string; category: string; area: string; description: string; status: string; created_at: string; updated_at: string; owner_id?: string; admin_note?: string };

export async function submitSupportTicket(category: string, area: string, description: string): Promise<string> {
  const response = await customFetch<{ ticket: { id: string } }>('/api/support/tickets', {
    method: 'POST', responseType: 'json',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, area, description }),
  });
  return response.ticket.id;
}

export async function getSupportTickets(admin = false): Promise<Ticket[]> {
  const path = admin ? '/api/support/admin/tickets' : '/api/support/tickets';
  const response = await customFetch<{ tickets: Ticket[] }>(path, { method: 'GET', responseType: 'json' });
  return response.tickets;
}

export async function updateSupportTicket(id: string, status: string, adminNote: string): Promise<void> {
  await customFetch('/api/support/admin/tickets/' + encodeURIComponent(id), {
    method: 'PATCH', responseType: 'json', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, adminNote }),
  });
}
