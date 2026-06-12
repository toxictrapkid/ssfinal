import sys
import time
from playwright.sync_api import Playwright, sync_playwright
from dotenv import load_dotenv
from bs4 import BeautifulSoup
from get_data import parse_vehicle_data
import pandas as pd
import os
import json

load_dotenv()

print('*'*10)
print('## CREATED BY @kevmaindev ###')
print('*'*10)

FACEBOOK_EMAIL = os.getenv('FACEBOOK_EMAIL')
FACEBOOK_PASSWORD = os.getenv('FACEBOOK_PASSWORD')

main_folder= os.path.abspath(os.getcwd())

Base_url = 'https://web.facebook.com/marketplace/'

storage_dir = 'SESSIONS/StorageCookies'
os.makedirs(storage_dir,exist_ok=True)

storage = f'{main_folder}/{storage_dir}/{FACEBOOK_EMAIL}.json'

""" ##### SETTINGS ####
"""
location = 'nyc'
min_price = 1000
max_price = 30000
days_listed = 7
min_mileage = 50000
max_mileage = 200000
min_year = 2000
max_year = 2020
transmission = "automatic"
make = "Honda"
model = "Civic"
scroll_count = 10  # amount of times the script should scroll for more data


def abort_requests(route, request):    
    if request.resource_type == "image" or any(ext in request.url.lower() for ext in [".png", ".jpg", ".jpeg"]):
        route.abort()
        return
    if request.resource_type == "media" or any(ext in request.url.lower() for ext in [".mp4", ".webm", ".avi"]):
        route.abort()
        return    
    route.continue_()
 
def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False)
    if os.path.isfile(storage):
        print('logging in with session\n')

        context = browser.new_context(storage_state=storage,locale="en-GB",color_scheme='dark')                              
        page = context.new_page()
        page.route("**/*", abort_requests)
        page.goto(Base_url)
        page.wait_for_timeout(5000)
        print('logged in with session\n')
    else:
        context = browser.new_context(locale="en-GB",color_scheme='dark')                                
        page = context.new_page()
        page.wait_for_timeout(1000)
        page.route("**/*", abort_requests)
        page.goto(Base_url)
        page.wait_for_timeout(5000)
        page.get_by_role("textbox", name="Email address or phone number").click()
        page.keyboard.type(FACEBOOK_EMAIL)
        page.wait_for_timeout(3000)
        page.locator("input[id='«r15»']").click()
        page.keyboard.type(FACEBOOK_PASSWORD)
        page.wait_for_timeout(1000)
        page.get_by_role("button", name="Log in to Facebook").click()
        page.wait_for_timeout(5000)
        print('logged in\n')

        page.context.storage_state(path=storage)
        print('Saved your login state details\n')


    #Set up full url   
    url = f"{Base_url}{location}/search?minPrice={min_price}&maxPrice={max_price}&daysSinceListed={days_listed}&maxMileage={max_mileage}&maxYear={max_year}&minMileage={min_mileage}&minYear={min_year}&transmissionType={transmission}&query={make}{model}&exact=false"
    page.goto(url)
    page.wait_for_timeout(3000)
    scroll_delay = 2
    unique_vehicles = []
    seen_vehicles = set()  
    
    for i in range(scroll_count):
        page.evaluate("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(scroll_delay)
        print(f'Scrolled {i+1} times',end='\r')
        page_content = page.content()
        soup = BeautifulSoup(page_content, 'lxml')
        new_vehicles = parse_vehicle_data(soup)
        for vehicle in new_vehicles:
            vehicle_id = frozenset(vehicle.items())
            
            if vehicle_id not in seen_vehicles:
                seen_vehicles.add(vehicle_id)
                unique_vehicles.append(vehicle)
        page.wait_for_timeout(3000)

    os.makedirs('DATA',exist_ok=True)
    #save json file
    with open('DATA/vehicles.json', 'w') as f:
       json.dump(unique_vehicles,f)
    #save csv file
    df = pd.DataFrame(unique_vehicles)
    df.to_csv('DATA/vehicles.csv')

    print(f'\n\nTotal sacraped : {len(unique_vehicles)} Items\n')
    
    context.close()
    browser.close()

if __name__ == '__main__':
    with sync_playwright() as playwright:
        try:
          run(playwright)
        except Exception as e:
            print('Error',e)
        except KeyboardInterrupt:
            sys.exit(1)
