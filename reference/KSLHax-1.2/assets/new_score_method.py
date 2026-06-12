from dataclasses import dataclass, field
from typing import Literal
import time as t

# ==============================================
# Ignore this code for now. Just scroll down.
# ==============================================
@dataclass
class Car:
    price: int
    score: int = 0
    numberDoors: int = 4
    newUsed: str = "Unknown"
    displayTime: int = 0
    titleType: str = "Unknown"
    city: str = "Unknown"
    fuel: str = "Unknown"
    paint: list[str] = field(default_factory=list) 
    body: Literal["Coupe", "Sedan", "Hatchback"] | str = "Unkown"
    modifyTime: int = 0
    transmission: Literal["Automanual", "Automatic", "Manual"] | str = "Unkown"
    trim: str | None = None
    vin: str = "Unknown"
    model: str = "Unknown"
    id: int = 1234
    state: str = "Unknown"
    make: str = "Unknown"
    email: str = "Unknown"
    memberId: int = 0
    mileage: int = 1234
    contactMethod: list[Literal["phone","email","text","messages","phoneEmail"] | str] = field(default_factory=list) 
    zip: str = "Unknown"
    address1: str = "Unknown"
    makeYear: int = 1970
    photo: list[dict] | list[str] = field(default_factory=list) 
    firstName: str = "John (Doe)"
    primaryPhone: str = "Unknown"
    expireTime: int = 0
    mobilePhone: str = "Unknown"
    createTime: int = 0
    dealer: dict = field(default_factory=dict) 
    sellerType: Literal["Dealership", "For Sale By Owner"] | str = "Unkown"
    status: Literal["Active"] = "Active"
    favoritedByCurrentUser: bool = False

def __score__(car: Car) -> int | None:
    '''
        This code is ran for every car that
        is found.
        Simply set and adjust a score for 
        each property that the car has.
        The properties of the car are
        listed above, with their possible
        values. Simply utilize if and 
        else statements to solve the 
        score for each attribute.

        Ex.:
        if car.price > 10000:
            score -= 20

        Ex.: 
        #  Make upper case             Remove the car from the list
        if car.make.upper() != "FORD": return
    '''
    score = 0

    # Your operations

    return score
