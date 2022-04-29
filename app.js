const express = require("express");
const bodyParser = require("body-parser");
const session = require("cookie-session");
const mongoose = require("mongoose");
const passport = require("passport");
const Schema = mongoose.Schema;
const passportLocalMongoose = require("passport-local-mongoose");
const axios = require("axios");

const app = express();
const port = process.env.PORT || 3000;

const SESSION_SECRET = "iot123";
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,
        maxAge: 1000 * 60 * 60 * 24
    }
}));

app.use(passport.initialize());
app.use(passport.session());

app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"))

const mongoURL = "mongodb+srv://jcgg:jcgg@cluster0.ohdif.mongodb.net/iot-project?retryWrites=true&w=majority";
try {
    mongoose.connect(
        mongoURL, 
        { useNewUrlParser: true, useUnifiedTopology: true },
        () => console.log("Mongoose is connected to the database.")
        );
} catch(e) {
    console.log("Mongoose failed to connect.");
}

const userSchema = new Schema({
    email: String,
    password: String, 
    name: String,
    gender: String,
    admin: { type: Boolean, default: false }
});
userSchema.plugin(passportLocalMongoose);
const User = mongoose.model("User", userSchema);
passport.use(User.createStrategy());
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

const vehicleSchema = new Schema({
    route: String,
    id: String,
    seats: Number,
    passengerLimit: Number,
    channelId: String,
    apiKey: String
});
const Vehicle = mongoose.model("Vehicle", vehicleSchema);

app.use(function(req, res, next) {
    res.locals.session = req.session;
    next();
});

app.get("/", function(req, res) {
    res.render("home");
});

app.get("/login", function(req, res) {
    if (req.isAuthenticated()) {
        res.redirect("/");
    } else {
        res.render("login");
    }
});

app.post("/login", function(req, res) {
    const user = new User({
        username: req.body.username,
        password: req.body.password
    });
    
    req.login(user, function(err) {
        if (err) {
            console.log(err);
        } else {
            passport.authenticate("local")(req, res, function() {
                req.session.loggedin = true;
                if (req.user.admin) { req.session.admin = true; }
                res.redirect("/");
            });
        }
    });
});

app.get("/logout", function(req, res) {
    req.logout();
    req.session.loggedin = false;
    req.session.admin = false;
    res.redirect("/");
});

app.get("/register", function(req, res) {
    if (req.isAuthenticated()) {
        res.redirect("/");
    } else {
        res.render("register");
    }
});

app.post("/register", function(req, res) {
    if (req.isAuthenticated()) {
        res.redirect("/");
    } else {
        const newUser = new User({
            username: req.body.username,
            name: req.body.name,
            gender: req.body.gender
        });
    
        User.register(newUser, req.body.password, function(err, user) {
            if (err) {
                console.log(err);
                res.redirect("/register");
            } else {
                passport.authenticate("local")(req, res, function() {
                    req.session.loggedin = true;
                    if (req.user.admin) { req.session.admin = true; }
                    res.redirect("/login");
                });
            }
        });
    }
});

app.get("/bus", function(req, res) {
    Vehicle.findOne({ id: req.query.id }, function(err, docs) {
        if (err) {
            console.log(err);
            res.redirect("/");
        } else {
            if (docs) {
                let iotURL = "https://api.thingspeak.com/channels/" + docs.channelId + "/feeds.json?results=1";
                if (docs.apiKey) {
                    iotURL += "&api_key=" + docs.apiKey;
                }

                axios.get(iotURL)
                    .then(response => {
                        const currentPassengers = response.data.feeds[0].field1;
                        const seatsInUse = response.data.feeds[0].field2;

                        res.render("bus", { 
                            id: docs.id, 
                            route: docs.route,
                            currentPassengers: currentPassengers,
                            passengerLimit: docs.passengerLimit,
                            seats: docs.seats,
                            seatsInUse: seatsInUse
                        });
                    });
            } else {
                res.redirect("/not_found");
            }
        }
    });
});

app.get("/bus_list", function(req, res) {
    if (req.isAuthenticated()) {
        if (!req.user.admin) {
            res.redirect("/");
        } else {
            let greeting = "Bienvenidx";
            if (req.user.gender === "mujer") {
                greeting = "Bienvenida";
            } else if (req.user.gender ==="hombre") {
                greeting = "Bienvenido";
            }

            Vehicle.find({}, function(err, docs) {
                if (err) { console.log(err) }
                else {
                    const buses = [];
                    let promises = [];
                    docs.forEach(bus => {
                        let iotURL = "https://api.thingspeak.com/channels/" + bus.channelId + "/feeds.json?results=1";
                        if (bus.apiKey) {
                            iotURL += "&api_key=" + bus.apiKey;
                        }
                        promises.push(
                            axios.get(iotURL)
                                .then(response => {
                                    const currentPassengers = response.data.feeds[0].field1;
                                    const seatsInUse = response.data.feeds[0].field2;
        
                                    const newBus = {
                                        route: bus.route,
                                        id: bus.id,
                                        seats: bus.seats,
                                        seatsInUse: seatsInUse,
                                        passengerLimit: bus.passengerLimit,
                                        currentPassengers: currentPassengers
                                    }
                                    buses.push(newBus);
                                })
                        );
                    });

                    Promise.all(promises).then(() => {
                        res.render("bus_list", { greeting: greeting, name: req.user.name, buses: buses });
                    })
                }
            });
        }
    } else {
        res.redirect("/login");
    }
});

app.get("/add_bus", function(req, res) {
    if (req.isAuthenticated()) {
        if (!req.user.admin) {
            res.redirect("/");
        } else {
            res.render("add_bus");
        }
    } else {
        res.redirect("/login");
    }
});

app.post("/add_bus", function(req, res) {
    const newVehicle = new Vehicle({
        route: req.body.route,
        id: req.body.id,
        seats: req.body.seats,
        passengerLimit: req.body.passengerLimit,
        channelId: req.body.channelId,
        apiKey: req.body.apiKey
    });

    newVehicle.save(function (err) {
        if (err) { console.log(err); }
        else { res.redirect("/bus_list"); }
    });
});

app.get("/edit_bus", function(req, res) {
    if (req.isAuthenticated()) {
        if (!req.user.admin) {
            res.redirect("/");
        } else {
            Vehicle.findOne({ id: req.query.id }, function(err, docs) {
                res.render("edit_bus", {
                    route: docs.route,
                    id: docs.id,
                    seats: docs.seats,
                    passengerLimit: docs.passengerLimit,
                    channelId: docs.channelId,
                    apiKey: docs.apiKey
                });
            });
        }
    } else {
        res.redirect("/login");
    }
});

app.post("/edit_bus", function(req, res) {
    const vehicleUpdates = {
        route: req.body.route,
        seats: req.body.seats,
        passengerLimit: req.body.passengerLimit,
        channelId: req.body.channelId,
        apiKey: req.body.apiKey
    };

    Vehicle.findOneAndUpdate({ id: req.body.id }, { $set: vehicleUpdates }, { returnNewDocument: true }, function(err, docs) {
        if (err) { console.log(err) }
        else {
            res.redirect("/bus_list");
        }
    });
});

app.get("/delete_bus", function(req, res) {
    console.log(req.query)
    Vehicle.findOneAndDelete({ id: req.query.id }, function(err, docs) {
        if (err) { console.log(err) }
        else {
            res.redirect("/bus_list");
        }
    });
});

app.get("/not_found", function(req, res) {
    res.render("not_found");
});

app.listen(port, function() {
    console.log("App listening on port " + port);
});