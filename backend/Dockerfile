FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --create-home app && mkdir -p /app/media /app/var/exports /app/staticfiles && chown -R app /app
USER app
RUN DJANGO_DEBUG=false DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput >/dev/null
EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn config.wsgi:application -b 0.0.0.0:8000 -w ${GUNICORN_WORKERS:-3} --access-logfile -"]
