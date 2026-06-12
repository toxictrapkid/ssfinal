from urllib.parse import unquote_plus
from dataclasses import asdict
import importlib.util as ilu
from dacite import from_dict
from typing import Callable
import requests as r
import traceback
import json as j
import time as t
import sys
import os

from error_handling import ErrorData, DescriptiveException
from data_types import Car, Configuration
from resources import ResourceManager

# Under normal circumstances, this is the URL that would be called
main_url: str = "https://cars.ksl.com/search/make/Acura;Ford;Honda;Mazda;Mitsubishi;Toyota;Volkswagen/model/TL;Fiesta;Focus;Fusion;Taurus;Accord;Civic;Fit;Mazda2;Mazda3;Mazda3+Hatchback;Mazda3+Sedan;Mazda6;Eclipse;Eclipse+Spyder;Lancer;Camry;Celica;Corolla;Echo;Yaris;Yaris+Hatchback;Golf/mileageTo/160000/priceTo/5000/zip/84123/miles/25/priceFrom/2000/titleType/Clean+Title/yearFrom/1995"

top_picks_length: int = 3

def requestCars(session: r.Session, headers: dict, page: int, url: str = main_url, first_listing_id: str | None = None) -> list:
    '''
    Request the page of
    cars given. Gives
    them as a list of 
    objects.
    '''
    url_getCars = "https://cars.ksl.com/nextjs-api/proxy?"

    assert "https://cars.ksl.com/search/" in url, "URL must be a KSL URL"

    # Remove trailing spaces, remove domain name, remove random hashtag, then parse from url to normal string
    url = unquote_plus(url.strip().removeprefix("https://cars.ksl.com/search/").removesuffix("#"))
    # Make the ability to sift through pages
    request_body: list = []
    # Break URL into a list (because that is what the database understands)
    request_body.extend(url.split( "/" ))
    # Add the query group
    request_body.extend(["perPage", 24, "page", page])
    if first_listing_id:
        request_body.extend(["firstListingId", first_listing_id])
    request_body.extend(["es_query_group",None])

    adjusted_headers: dict = headers.copy()
    adjusted_headers.update({"Referer": url})

    data = {
        "endpoint":"/classifieds/cars/search/searchByUrlParams",
        "options":{
            "method":"POST",
            "headers":{
                "Content-Type":"application/json",
                "User-Agent":"cars-node",
                "X-App-Source":"frontline",
                "X-DDM-EVENT-USER-AGENT":{},
                "X-DDM-EVENT-ACCEPT-LANGUAGE":"en-US",
                "X-MEMBER-ID":None,
                "cookie":""
            },
            "body":request_body
        }
    }
    
    the_response: r.Response = session.post(url_getCars, headers=headers, allow_redirects=True, json=data)
    assert the_response.status_code == 200, f"There was a mishap when gathering car data.\n\nRelevant Information:\n{the_response.text}"
    the_json: dict = the_response.json()
    return the_json.get("data").get("items")


def requestAllCars(session: r.Session, headers: dict, url: str = main_url, max_pages: int = 5) -> list:
    '''
    Request all pages of cars,
    and join the lists 
    together to make one large 
    list of all of the cars.
    '''
    the_masses: list = []

    if ResourceManager.offline_mode:
        print("WARNING, APPLICATION IS IN TEST MODE.")
        return ResourceManager.scored_data.read()
    
    count: int = 0
    while count!=max_pages:
        count+=1
        data = requestCars(session, headers, count, url)
        print(f"New page of cars discovered! Page: {count}{' but it is empty...' if data==[] else ''}")
        if data == []: break
        the_masses.extend(data)

    return the_masses


def filter_wrapper(configuration: Configuration, callback: Callable[[list[Car], ErrorData], None] | None = None) -> None:
    '''
    Wraps the filter function
    to catch any errors
    that may arise and hand
    them to the caller.
    '''
    try:
        return filter(configuration, lambda data : callback(data, ErrorData()))
    except AssertionError as msg:
        callback(
            [],
            ErrorData(text="The Following Error Occurred While Searching Cars:", simple_msg=msg, stack_trace=traceback.format_exc())
        )
    except DescriptiveException as e:
        callback([], e.message)
    except Exception as e:
        callback(
            [],
            ErrorData(text="The Following Unknown Error Occurred While Searching Cars:", simple_msg=e, stack_trace=traceback.format_exc())
        )


def filter(configuration: Configuration, callback: Callable[[list[Car]], None] | None = None) -> None:
    '''
    Gets all of the cars
    based off of the 
    configuration given.

    Runs the callback with
    all of the cars that 
    are unblacklisted.
    '''
    if callback==None:  callback = lambda x : print(x)
    if configuration.url == "": configuration.url = main_url

    with r.Session() as s:
        headers = {
            'User-Agent': configuration.user_agent,
            # 'User-Agent': 'ksl-crawler',
            'Content-Type': 'application/json',
            'Host': 'cars.ksl.com',
            'Origin': 'https://cars.ksl.com'
        }

        raw = requestAllCars(s, headers, configuration.url, configuration.page_count)

        start_time = t.perf_counter()
        raw = remove_duplicates(raw)
        data = remove_blacklisted( convert_to_car(raw) ) 
        scored_data = score_data(data, configuration.score_script_location)
        print(f"The size of the scored data is: {len(scored_data)}")

        ResourceManager.scored_data.write([asdict(x) for x in scored_data])

        mark_old(scored_data:=mark_new(scored_data))

        finish_time = t.perf_counter()
        print(f"Completed in {round(finish_time - start_time, 3)}s")
        callback(scored_data)


def score_data(data: list[Car], scoring_module: str = f"{os.getcwd()}\\scoring\\default_scoring.py"):
    '''
    Scores all of the cars
    given to it, and sorts
    them by the score given.
    '''
    try:
        spec = ilu.spec_from_file_location("module.name", scoring_module)
        scoring = ilu.module_from_spec(spec)
        sys.modules["module.name"] = scoring
        spec.loader.exec_module(scoring)

        new_list: list[Car] = []
        for item in data:
            score = 0
        
            score = scoring.__score__(item)

            if score == None: continue
            else: item.score = score

            new_list.append(item)

        return sorted(new_list, key=lambda car: car.score, reverse=True)
    except Exception as e:
        raise DescriptiveException(ErrorData(title="Your Fault.", text="Your Script Caused an Error:", stack_trace="".join(traceback.format_exception_only(e))))


def remove_duplicates(data: list[dict]):
    '''
    Removes all duplicates
    found in the dictionary
    '''
    returnable = []
    [returnable.append(i) for i in data if i not in returnable]
    return returnable


def format_car(car: dict):
    '''
    Formats the car
    to be ready for
    conversion into
    an object and be 
    used.

    To be more precise,
    setup the photo key
    to equal a valid id,
    or no id at all.
    '''
    if "photo" in car and len(car["photo"]) > 0:
        photo = car["photo"][0]
        if type(photo) == str:
            photo = j.loads(photo)
        car["photo"] = photo.get("id")
    else:
        car["photo"] = None
    return car


def convert_to_car(data: list[dict], format_car_first: bool = True) -> list[Car]:
    '''
    Convert the list of
    dictionaries given
    to the Car data
    type.

    if format_car_first
    is true, this will
    format the dictionary
    using the `format_car`
    method firsat before
    converting it into
    type Car.
    '''
    if format_car_first:
        return [from_dict(Car, format_car(i)) for i in data]
    else:
        return [from_dict(Car, i) for i in data]


def remove_blacklisted(data: list[Car]):   
    '''
    Removes all cars that
    were previously known
    as blacklisted.
    ''' 
    blacklist: list[str] = ResourceManager.blacklist_data.read()
    return [i for i in data if (not i.id in blacklist)]


def mark_new(data: list[Car]):
    '''
    Marks all previously
    undiscovered cars as 
    new.

    This changes the data
    inside the variable.
    '''
    old_list: list[str] = ResourceManager.old_data.read()
    new_data = []
    for i in data:
        if i.id not in old_list:
            i.newCar = True
        new_data.append(i)
    return new_data


def mark_old(data: list[Car]):
    '''
    Writes all cars given
    as old.

    This changes the data
    written to disk.
    '''
    x = ResourceManager.old_data.read()

    for i in data: x.append(i.id)
    
    ResourceManager.old_data.write(x)