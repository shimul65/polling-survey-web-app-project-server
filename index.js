const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5066;


// middleware
app.use(cors({
    origin: [
        'http://localhost:5173',
        // 'https://survey-app-assignment-shimul.web.app/',
        // 'https://survey-app-assignment-shimul.firebaseapp.com/',
        // 'https://survey-app-assignment-shimul.surge.sh/',
    ],
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.n45ephu.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {

        const usersCollection = client.db('surveyDb').collection('users');
        const surveyCollection = client.db('surveyDb').collection('surveys');
        const paymentCollection = client.db('surveyDb').collection('payments');


        //jwt related api
        app.post('/jwt', async (req, res) => {
            const user = req.body
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '2h' })
            res
                .cookie('token', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === "production" ? true : false,
                    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",

                }).send({ success: true });
        })

        // clear coolie when user logged out
        app.post('/logout', async (req, res) => {
            res
                .clearCookie('token', {
                    maxAge: 0,
                    secure: process.env.NODE_ENV === "production" ? true : false,
                    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
                })
                .send({ success: true });
        })

        // token verify middleware
        const verifyToken = async (req, res, next) => {
            const token = req.cookies?.token;
            if (!token) {
                return res.status(401).send({ message: 'unauthorized access' })
            }
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    console.log(err);
                    return res.status(403).send({ message: 'forbidden access...' })
                }
                // console.log('value in the token is :', decoded);
                req.user = decoded;
                next();
            })
        }

        // use verify admin after verify token
        const verifyAdmin = async (req, res, next) => {
            const email = req.user.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            const isAdmin = user?.role === 'Admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access...' });
            }
            next();
        }


        //users related api
        app.get('/users', verifyToken, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        })

        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.user.email) {
                return res.status(403).send({ message: ' forbidden access' });
            }
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            let admin = false;
            if (user) {
                admin = user?.role === 'Admin';
            }
            res.send({ admin });
        })

        app.get('/users/surveyor/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.user.email) {
                return res.status(403).send({ message: ' forbidden access' });
            }
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            let surveyor = false;
            if (user) {
                surveyor = user?.role === 'Surveyor';
            }
            res.send({ surveyor });
        })

        app.patch('/users/:state', verifyToken, verifyAdmin, async (req, res) => {
            const updateStatus = req.body;
            const state = req.params.state;
            let query = {}
            if (state === req.user.email) {
                query = { email: req.user.email }
            }
            else {
                query = { _id: new ObjectId(state) };
            }
            const options = { upsert: true };
            const updateRole = {
                $set: {
                    role: updateStatus.role,
                }
            }
            const result = await usersCollection.updateOne(query, updateRole, options);
            res.send(result);
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await usersCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'User already exists', insertedId: null })
            }
            const result = await usersCollection.insertOne(user);
            res.send(result)
        })

        app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(query);
            res.send(result);
        })



        //survey related api
        app.get('/surveys', verifyToken, async (req, res) => {
            const surveyorEmail = req.query?.email;
            const query = {
                email: surveyorEmail
            }
            const result = await surveyCollection.find(query).toArray();
            res.send(result);
        })

        app.get('/surveys/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await surveyCollection.findOne(query);
            res.send(result);
        })

        app.patch('/surveys/:id', async (req, res) => {
            const updateSurvey = req.body;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const options = { upsert: true };
            const newMenu = {
                $set: {
                    title: updateSurvey.title,
                    question: updateSurvey.question,
                    image: updateSurvey.image,
                    category: updateSurvey.category,
                    deadline: updateSurvey.deadline,
                }
            }
            const result = await surveyCollection.updateOne(query, newMenu, options);
            res.send(result);
        })

        app.post('/surveys', verifyToken, async (req, res) => {
            const newSurvey = {
                ...req.body,
                timestamp: new Date()
            };
            const result = await surveyCollection.insertOne(newSurvey)
            res.send(result);
        })



        // payment intent
        app.post("/create-payment-intent", async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            // console.log(amount);

            // Create a PaymentIntent with the order amount and currency
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        app.get('/payments', verifyToken, async (req, res) => {
            const result = await paymentCollection.find().toArray();
            res.send(result);
        })

        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const result = await paymentCollection.insertOne(payment);
            res.send(result);
        })



        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // await client.close();
    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send('polling and survey web app assignment server is running')
})

app.listen(port, () => {
    console.log(`Simple polling and survey web app assignment server is running on port ${port}`)
})