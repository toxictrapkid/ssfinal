# Daytona scraper snapshot for CarHunter.
# Build → register as a Daytona snapshot named "carhunter-scraper"
# (the name convex/lib/daytonaClient.ts asks Daytona to launch).
# The Convex cron creates a sandbox from this image every 15 min, runs
# `python3 run.py --config '<json>'` in /scrapers, then tears it down.
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

# scrapers live at /scrapers — daytonaClient.ts execs `cd /scrapers && python3 run.py`
WORKDIR /scrapers
COPY scrapers/requirements.txt /scrapers/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY scrapers/ /scrapers/

# KSL path is requests-only; Playwright (already in the base image) rides along
# for the Facebook source when it is re-enabled.
ENV PYTHONUNBUFFERED=1
CMD ["python3", "-c", "print('carhunter-scraper image ready; invoked per-run by the Convex Daytona action')"]
