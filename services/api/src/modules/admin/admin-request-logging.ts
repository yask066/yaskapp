export type AdminFailureLogInput = {
  requestId: string;
  method: string;
  route: string;
  statusCode: number;
  actorUserId?: string;
};

export function isAdminFailureRequest(url: string, statusCode: number) {
  const path = url.split('?', 1)[0];
  return (path === '/admin' || path.startsWith('/admin/')) && statusCode >= 400;
}

export function buildAdminFailureLog(input: AdminFailureLogInput) {
  return {
    event: 'admin_request_failed',
    requestId: input.requestId,
    method: input.method,
    route: input.route,
    statusCode: input.statusCode,
    actorUserId: input.actorUserId ?? null
  };
}
