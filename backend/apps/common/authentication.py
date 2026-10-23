from rest_framework.authentication import SessionAuthentication


class SessionAuthentication401(SessionAuthentication):
    """Session auth that answers 401 (not 403) when no valid session is presented.

    The SPA uses 401 to detect an expired session and send the user back to login,
    while 403 keeps meaning "authenticated but not permitted" (QA-D-04).
    """

    def authenticate_header(self, request):
        return 'Session realm="api"'
