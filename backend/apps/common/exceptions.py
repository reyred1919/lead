from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler as drf_exception_handler


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "این رکورد هم‌زمان توسط کاربر دیگری تغییر کرده است. صفحه را تازه کنید."
    default_code = "version_conflict"


class BusinessRuleViolation(APIException):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_detail = "این عملیات با قواعد کسب‌وکار سازگار نیست."
    default_code = "rule_violation"

    def __init__(self, detail=None, code=None):
        super().__init__(detail=detail, code=code or self.default_code)


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is not None and isinstance(response.data, dict) and hasattr(exc, "get_codes"):
        codes = exc.get_codes()
        if isinstance(codes, str):
            response.data["code"] = codes
    return response
