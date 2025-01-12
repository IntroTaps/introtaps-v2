import React, { useEffect, useState } from 'react';

function HeroOther({ title, words, tagline, type }) {
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
      
  useEffect(() => {
      const interval = setInterval(() => {
          setCurrentWordIndex((prevIndex) => (prevIndex + 1) % words.length);
      }, 1000); // Change word every 2 seconds

      return () => clearInterval(interval);
  }, [words]);
  
  return (
    <div className={`hero-section ${type === 'premium' ? 'green-bg' : ''}`}>
      <div className="container">
        <div className="text-center">
          <h1 className={`heading-bold-1 ${type === 'premium' ? '' : 'text-white'}`}>{title} <b className={`${type === 'premium' ? '' : 'text-green'}`}>{words[currentWordIndex]}.</b></h1>
          <p className={`${type === 'premium' ? '' : 'text-white-50'}`}>
            {tagline}
          </p>
        </div>
      </div>
    </div>
  );
}

export default HeroOther;
