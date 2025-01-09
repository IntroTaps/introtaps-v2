import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
const words = ["Students", "CEOs", "Entrepreneurs", "Freelancers", "Tech Guys", "Influencers", "Professionals", "Business Owners", "Salespeople", "Marketers", "Consultants", "Designers", "Developers", "Managers", "Recruiters", "Investors", "Realtors", "You!", "Anyone"];

function Hero() {
    const [currentWordIndex, setCurrentWordIndex] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentWordIndex((prevIndex) => (prevIndex + 1) % words.length);
        }, 1000); // Change word every 2 seconds

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="hero min-vh-100 max-vh-100 d-flex align-items-center mt-0">
            <div className="container justify-content-center text-center">
                        <h1 className="hero-heading ">
                            The <b className="text-green">#1</b> Business Card
                            <br />
                            for <b className="rotating-text text-green">{words[currentWordIndex]}</b>
                        </h1>
                        <p className='secondline'>Share your contact info with a single tap on any phone</p>
                        <p><b>No App Required!</b></p>
                        <div className="mt-4 mb-4">
                            <a href="#" className="btn btn-primary btn-lg">Get Started</a>&nbsp;&nbsp;
                            
                            <Link to="/business" className='btn btn-outline-primary btn-lg ml-1'>For Businesses</Link>
                        </div>
                        <img src="/cardgreen.png" alt="" height="220px" className='imgcardgreen'/>

            </div>
        </div>
    );
}

export default Hero;
